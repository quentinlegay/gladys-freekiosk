// -----------------------------------------------------------------------------
// The integration logic, independent of the SDK wiring (index.js) so the tests
// can drive it with the SDK's fake Gladys and a fake FreeKiosk client.
//
// It owns the registry of known tablets (src/registry.js), their last known
// status and availability, and turns Gladys requests (scan, poll, command,
// camera image, manifest and scene actions) into FreeKiosk REST calls.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  API,
  AVAILABILITY,
  CAMERA_MODE,
  CAMERA_QUALITIES,
  MAX_CAMERA_IMAGE_LENGTH,
  SCENE_TRIGGER_AVAILABILITY,
} from './constants.js';
import {
  buildDevice,
  buildStates,
  commandFor,
  featureKeyFromExternalId,
  normalizeStatus,
  tabletIdFromExternalId,
  tabletIds,
  tabletName,
} from './devices.js';
import { parseScanRange, scanHosts } from './network.js';
import { normalizeHost, TabletRegistry } from './registry.js';

const logger = createLogger({ name: 'freekiosk' });

// Re-send an unchanged reading every 30 minutes, so the history and the
// "last seen" of the device stay alive.
const STATES_HEARTBEAT_MS = 30 * 60 * 1000;

// Gladys' poll ticks drift by a few ms: a read due within 5 s runs now.
const POLL_TOLERANCE_MS = 5000;

export class TabletService {
  /**
   * @param {object} gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} client FreeKiosk client (src/freekioskClient.js)
   * @param {{ refreshDelayMs?: number }} [options] delay of the status read
   *   that follows a command (0 = none, used by the tests)
   */
  constructor(gladys, client, { refreshDelayMs = 1500 } = {}) {
    this.gladys = gladys;
    this.client = client;
    this.refreshDelayMs = refreshDelayMs;
    this.config = normalizeConfig();
    this.registry = new TabletRegistry();
    this.statuses = new Map(); // tablet id -> normalized status
    this.availability = new Map(); // tablet id -> { online, authFailed, error }
    this.lastPolls = new Map(); // tablet id -> epoch ms
  }

  // --- Configuration ---------------------------------------------------------

  /** (Re)load the config and the registry it holds. */
  load(rawConfig) {
    this.config = normalizeConfig(rawConfig);
    this.registry = TabletRegistry.fromConfig(rawConfig);
    // Forget what belongs to tablets removed meanwhile.
    for (const map of [this.statuses, this.availability, this.lastPolls]) {
      for (const id of map.keys()) {
        if (!this.registry.get(id)) {
          map.delete(id);
        }
      }
    }
  }

  async save() {
    await this.gladys.setConfig(this.registry.toConfig());
  }

  /** Error message when the config is unusable, or null. */
  configError() {
    try {
      parseScanRange(this.config.scan_range);
      return null;
    } catch (err) {
      return {
        en: `Invalid scan range: ${err.message}.`,
        fr: `Plage de scan invalide : ${err.message}.`,
      };
    }
  }

  target(tablet) {
    return { host: tablet.host, port: tablet.port, apiKey: tablet.apiKey || this.config.api_key };
  }

  tabletFromExternalId(externalId) {
    const id = tabletIdFromExternalId(this.gladys, externalId);
    return id ? this.registry.get(id) : undefined;
  }

  requireTablet(externalId) {
    const tablet = this.tabletFromExternalId(externalId);
    if (!tablet) {
      throw new Error(`Unknown FreeKiosk tablet: ${externalId}`);
    }
    return tablet;
  }

  // --- Discovery -------------------------------------------------------------

  buildDiscoveredDevices() {
    return this.registry
      .list()
      .map((tablet) => buildDevice(this.gladys, tablet, this.config, this.statuses.get(tablet.id)));
  }

  async publishDiscoveredDevices() {
    await this.gladys.publishDiscoveredDevices(this.buildDiscoveredDevices());
  }

  /**
   * Refresh the known tablets, scan the configured range for new ones, save
   * the registry if it changed, and publish the discovered devices.
   * @returns {Promise<{ known: number, online: number, added: object[], moved: object[] }>}
   */
  async discover() {
    await Promise.all(this.registry.list().map((t) => this.refresh(t).catch(() => undefined)));

    const added = [];
    const moved = [];
    const hosts = parseScanRange(this.config.scan_range);
    if (hosts.length > 0) {
      logger.info(`Scanning ${hosts.length} address(es) on port ${this.config.default_port}...`);
      const port = this.config.default_port;
      const found = await scanHosts(hosts, (host) => this.client.probe({ host, port }));
      logger.info(`Scan finished: ${found.length} FreeKiosk tablet(s) answered`);
      for (const { host } of found) {
        if (this.registry.findByAddress(host, port)) {
          continue;
        }
        const result = await this.adopt({ host, port });
        (result.moved ? moved : added).push(result.tablet);
      }
    }

    if (added.length > 0 || moved.length > 0) {
      await this.save();
    }
    await this.publishDiscoveredDevices();
    const known = this.registry.list().length;
    const online = this.registry.list().filter((t) => this.availability.get(t.id)?.online).length;
    return { known, online, added, moved };
  }

  /**
   * A FreeKiosk tablet answered at an unknown address: read its status (with
   * the shared API key), then either follow a known tablet that moved there,
   * or register a new one. Unauthorized tablets are registered too: the user
   * then sets their key with the "Set a tablet's API key" action.
   */
  async adopt({ host, port }) {
    let status;
    try {
      status = normalizeStatus(await this.client.getStatus(this.target({ host, port })));
    } catch (err) {
      logger.warn(`Tablet found at ${host}:${port}, status unreadable: ${err.message}`);
    }
    const identity = status?.device ?? {};
    const candidate = this.registry.findMovedCandidate(
      identity,
      (t) => this.availability.get(t.id)?.online === false,
    );
    if (candidate) {
      logger.info(`Tablet ${tabletName(candidate)} moved to ${host}:${port}`);
      const tablet = this.registry.update(candidate.id, { host, port });
      if (status) {
        await this.applyStatus(tablet, status);
      }
      return { tablet, moved: true };
    }
    const { tablet } = this.registry.add({
      host,
      port,
      model: identity.model,
      manufacturer: identity.manufacturer,
      name: identity.model ? `FreeKiosk ${identity.model}` : undefined,
    });
    if (status) {
      await this.applyStatus(tablet, status);
    }
    logger.info(`New tablet registered: ${tabletName(tablet)} (${host}:${port})`);
    return { tablet, moved: false };
  }

  // --- Status & availability -------------------------------------------------

  /** Read the status of one tablet and publish its states. */
  async refresh(tablet) {
    let status;
    try {
      status = normalizeStatus(await this.client.getStatus(this.target(tablet)));
    } catch (err) {
      await this.setAvailability(tablet, {
        // An HTTP answer, even a refusal, means the tablet is up.
        online: err.status !== undefined,
        authFailed: err.code === 'UNAUTHORIZED',
        error: err.message,
      });
      throw err;
    }
    await this.applyStatus(tablet, status);
    return status;
  }

  async applyStatus(tablet, status) {
    this.statuses.set(tablet.id, status);
    if (status.device.model && !tablet.model) {
      this.registry.update(tablet.id, {
        model: status.device.model,
        manufacturer: status.device.manufacturer,
      });
    }
    await this.setAvailability(tablet, { online: true, authFailed: false });
    const states = buildStates(this.gladys, tablet, status);
    if (states.length > 0 && this.isCreated(tablet)) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATES_HEARTBEAT_MS });
    }
  }

  /** Only the devices the user created in Gladys accept states. */
  isCreated(tablet) {
    const externalId = tabletIds(this.gladys, tablet).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /**
   * Record whether a tablet answers, and on a change: update its transport
   * badge and fire the availability scene trigger (one event per transition,
   * never for the first observation after a start).
   */
  async setAvailability(tablet, next) {
    const previous = this.availability.get(tablet.id);
    this.availability.set(tablet.id, next);
    if (previous && previous.online === next.online && previous.authFailed === next.authFailed) {
      return;
    }
    if (!this.isCreated(tablet)) {
      return;
    }
    const externalId = tabletIds(this.gladys, tablet).device;
    const entry = next.online
      ? { external_id: externalId, transport: DEVICE_TRANSPORTS.LOCAL }
      : { external_id: externalId, transport: DEVICE_TRANSPORTS.UNREACHABLE };
    if (next.authFailed) {
      entry.degraded = true;
      entry.message = {
        en: 'FreeKiosk refused the API key: set it with the "Set a tablet\'s API key" action.',
        fr: "FreeKiosk a refusé la clé d'API : renseignez-la avec l'action « Définir la clé d'API d'une tablette ».",
      };
    }
    await this.gladys
      .publishTransports([entry])
      .catch((err) => logger.warn(`publishTransports failed: ${err.message}`));

    if (previous && previous.online !== next.online) {
      const status = next.online ? AVAILABILITY.ONLINE : AVAILABILITY.OFFLINE;
      logger.info(`${tabletName(tablet)} is now ${status}`);
      await this.gladys
        .publishSceneEvent(SCENE_TRIGGER_AVAILABILITY, { device: externalId, status })
        .catch((err) => logger.warn(`publishSceneEvent failed: ${err.message}`));
    }
  }

  /** Publish the transport badge of every created tablet whose state is known. */
  async publishAllTransports() {
    const entries = this.registry
      .list()
      .filter((t) => this.availability.has(t.id) && this.isCreated(t))
      .map((t) => ({
        external_id: tabletIds(this.gladys, t).device,
        transport: this.availability.get(t.id).online
          ? DEVICE_TRANSPORTS.LOCAL
          : DEVICE_TRANSPORTS.UNREACHABLE,
      }));
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  // --- Gladys requests -------------------------------------------------------

  /**
   * onPoll: Gladys polls every 15 s, the tablet is read at the interval of the
   * config. Resolves true when the tablet was read.
   */
  async poll(device, now = Date.now()) {
    const tablet = this.tabletFromExternalId(device.external_id);
    if (!tablet) {
      return false;
    }
    const last = this.lastPolls.get(tablet.id);
    if (last !== undefined && now - last < this.config.poll_frequency * 1000 - POLL_TOLERANCE_MS) {
      return false;
    }
    this.lastPolls.set(tablet.id, now);
    try {
      await this.refresh(tablet);
    } catch (err) {
      // An unplugged tablet is a state (unreachable badge), not a failure.
      logger.debug(`Poll of ${tabletName(tablet)} failed: ${err.message}`);
    }
    return true;
  }

  /** onSetValue: run a command, publish the confirmed state. */
  async setValue(device, feature, value) {
    const tablet = this.requireTablet(device.external_id);
    const command = commandFor(featureKeyFromExternalId(feature.external_id), value);
    logger.info(`${tabletName(tablet)} <- ${command.path}`);
    await this.client.command(this.target(tablet), command.path, command.body);
    if (command.confirmed !== undefined) {
      await this.gladys.publishState(feature.external_id, command.confirmed);
    }
    this.scheduleRefresh(tablet);
  }

  /** Read the status again shortly after a command, once the tablet applied it. */
  scheduleRefresh(tablet) {
    if (!this.refreshDelayMs) {
      return;
    }
    setTimeout(() => {
      this.refresh(tablet).catch(() => undefined);
    }, this.refreshDelayMs).unref?.();
  }

  /** onGetImage: a fresh photo of the configured camera, under 150 KB. */
  async getImage(device) {
    const tablet = this.requireTablet(device.external_id);
    const camera = this.config.camera;
    if (camera !== CAMERA_MODE.FRONT && camera !== CAMERA_MODE.BACK) {
      throw new Error('The tablet camera is disabled in the integration configuration');
    }
    for (const quality of CAMERA_QUALITIES) {
      const jpeg = await this.client.getPhoto(this.target(tablet), { camera, quality });
      const image = `image/jpg;base64,${jpeg.toString('base64')}`;
      if (image.length <= MAX_CAMERA_IMAGE_LENGTH) {
        return image;
      }
      logger.debug(`Photo at quality ${quality} too large (${image.length} chars), retrying`);
    }
    throw new Error('The photo is larger than 150 KB even at the lowest quality');
  }

  /** onDeviceDeleted: forget the tablet (a later scan finds it again). */
  async forget(device) {
    const tablet = this.tabletFromExternalId(device.external_id);
    if (tablet && this.registry.remove(tablet.id)) {
      this.statuses.delete(tablet.id);
      this.availability.delete(tablet.id);
      this.lastPolls.delete(tablet.id);
      await this.save();
    }
  }

  // --- Manifest actions ------------------------------------------------------

  async actionScan() {
    const error = this.configError();
    if (error) {
      return error;
    }
    const { known, online, added, moved } = await this.discover();
    const scanned = this.config.scan_range !== '';
    return {
      en:
        `${known} tablet(s) known, ${online} reachable.` +
        (scanned ? ` Scan: ${added.length} new, ${moved.length} moved.` : ' No scan range set.') +
        (added.length > 0 ? ' Create them from the Discovery tab.' : ''),
      fr:
        `${known} tablette(s) connue(s), ${online} joignable(s).` +
        (scanned
          ? ` Scan : ${added.length} nouvelle(s), ${moved.length} déplacée(s).`
          : ' Aucune plage de scan configurée.') +
        (added.length > 0 ? " Créez-les depuis l'onglet Découverte." : ''),
    };
  }

  async actionAddTablet(fields) {
    const host = normalizeHost(fields.host);
    const port = Number(fields.port) || this.config.default_port;
    const apiKey = typeof fields.api_key === 'string' ? fields.api_key.trim() : '';
    if (!host) {
      return {
        en: 'Enter the IP address of the tablet.',
        fr: "Renseignez l'adresse IP de la tablette.",
      };
    }
    const target = { host, port, apiKey: apiKey || this.config.api_key };
    let status;
    try {
      status = normalizeStatus(await this.client.getStatus(target));
    } catch (err) {
      logger.warn(`Add tablet ${host}:${port} failed: ${err.message}`);
      if (err.code === 'UNAUTHORIZED') {
        return {
          en: `FreeKiosk answered at ${host}:${port} but refused the API key. Enter the key set in FreeKiosk > Advanced > REST API.`,
          fr: `FreeKiosk a répondu à ${host}:${port} mais a refusé la clé d'API. Renseignez la clé définie dans FreeKiosk > Avancé > API REST.`,
        };
      }
      return {
        en: `No FreeKiosk tablet answered at ${host}:${port} (${err.message}). Check the IP, the port and that the REST API is enabled.`,
        fr: `Aucune tablette FreeKiosk n'a répondu à ${host}:${port} (${err.message}). Vérifiez l'IP, le port et que l'API REST est activée.`,
      };
    }
    const name =
      typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : undefined;
    const { tablet, created } = this.registry.add({
      host,
      port,
      name: name ?? (status.device.model ? `FreeKiosk ${status.device.model}` : undefined),
      model: status.device.model,
      manufacturer: status.device.manufacturer,
      // Store a per-tablet key only when it differs from the shared one.
      apiKey: apiKey && apiKey !== this.config.api_key ? apiKey : undefined,
    });
    await this.applyStatus(tablet, status);
    await this.save();
    await this.publishDiscoveredDevices();
    const label = tabletName(tablet);
    return created
      ? {
          en: `"${label}" found. Create it from the Discovery tab.`,
          fr: `« ${label} » trouvée. Créez-la depuis l'onglet Découverte.`,
        }
      : {
          en: `"${label}" was already known: its settings were updated.`,
          fr: `« ${label} » était déjà connue : ses réglages ont été mis à jour.`,
        };
  }

  async actionSetApiKey(fields) {
    const tablet = this.requireTablet(fields.device);
    const apiKey = typeof fields.api_key === 'string' ? fields.api_key.trim() : '';
    if (apiKey) {
      tablet.apiKey = apiKey;
    } else {
      delete tablet.apiKey; // back to the shared key of the configuration
    }
    await this.save();
    try {
      await this.refresh(tablet);
    } catch (err) {
      return {
        en: `Key saved, but the tablet did not accept it yet: ${err.message}.`,
        fr: `Clé enregistrée, mais la tablette ne l'accepte pas encore : ${err.message}.`,
      };
    }
    return {
      en: `Key saved: "${tabletName(tablet)}" answers.`,
      fr: `Clé enregistrée : « ${tabletName(tablet)} » répond.`,
    };
  }

  async actionUpdateAddress(fields) {
    const tablet = this.requireTablet(fields.device);
    const host = normalizeHost(fields.host);
    if (!host) {
      return { en: 'Enter the new IP address.', fr: 'Renseignez la nouvelle adresse IP.' };
    }
    const port = Number(fields.port) || tablet.port;
    const other = this.registry.findByAddress(host, port);
    if (other && other.id !== tablet.id) {
      return {
        en: `${host}:${port} is already the address of "${tabletName(other)}".`,
        fr: `${host}:${port} est déjà l'adresse de « ${tabletName(other)} ».`,
      };
    }
    this.registry.update(tablet.id, { host, port });
    await this.save();
    await this.publishDiscoveredDevices();
    try {
      await this.refresh(tablet);
    } catch (err) {
      return {
        en: `Address saved, but the tablet does not answer there: ${err.message}.`,
        fr: `Adresse enregistrée, mais la tablette n'y répond pas : ${err.message}.`,
      };
    }
    return {
      en: `"${tabletName(tablet)}" answers at ${host}:${port}.`,
      fr: `« ${tabletName(tablet)} » répond à ${host}:${port}.`,
    };
  }

  /** Make the tablet signal itself: wake it, beep and show a message. */
  async identify(externalId) {
    const tablet = this.requireTablet(externalId);
    const target = this.target(tablet);
    await this.client.command(target, API.WAKE);
    await this.client.command(target, API.BEEP);
    await this.client.command(target, API.TOAST, { text: 'Gladys 👋' });
    return tablet;
  }

  async actionIdentify(fields) {
    try {
      const tablet = await this.identify(fields.device);
      return {
        en: `Look at "${tabletName(tablet)}": it beeps and shows a message.`,
        fr: `Regardez « ${tabletName(tablet)} » : elle bipe et affiche un message.`,
      };
    } catch (err) {
      return {
        en: `The tablet did not answer: ${err.message}.`,
        fr: `La tablette n'a pas répondu : ${err.message}.`,
      };
    }
  }

  // --- Scene actions ---------------------------------------------------------

  async sceneCommand(externalId, path, body) {
    const tablet = this.requireTablet(externalId);
    await this.client.command(this.target(tablet), path, body);
    if (path === API.URL) {
      this.scheduleRefresh(tablet);
    }
  }

  async sceneLoadUrl(fields) {
    await this.sceneCommand(fields.device, API.URL, { url: String(fields.url ?? '').trim() });
  }

  async sceneSpeak(fields) {
    const body = { text: String(fields.text ?? '') };
    if (fields.language) {
      body.language = String(fields.language).trim();
    }
    await this.sceneCommand(fields.device, API.TTS, body);
  }

  async sceneShowMessage(fields) {
    await this.sceneCommand(fields.device, API.TOAST, { text: String(fields.text ?? '') });
  }

  async scenePlayAudio(fields) {
    const body = { url: String(fields.url ?? '').trim(), loop: fields.loop === true };
    const volume = Number(fields.volume);
    if (fields.volume !== undefined && fields.volume !== null && Number.isFinite(volume)) {
      body.volume = Math.round(Math.min(100, Math.max(0, volume)));
    }
    await this.sceneCommand(fields.device, API.AUDIO_PLAY, body);
  }

  async sceneStopAudio(fields) {
    await this.sceneCommand(fields.device, API.AUDIO_STOP);
  }
}
