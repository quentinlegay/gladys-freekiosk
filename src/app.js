// -----------------------------------------------------------------------------
// SDK wiring: register every handler on a Gladys client. Kept out of index.js
// so the tests can run the real wiring against the SDK's fake Gladys.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { createFreeKioskClient } from './freekioskClient.js';
import { MANIFEST_ACTIONS, SCENE_ACTIONS } from './scenes.js';
import { TabletService } from './tabletService.js';
import { refreshWidgets, WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'freekiosk' });

/**
 * @param {object} gladys GladysIntegration instance (not yet connected)
 * @param {{ client?: object, refreshDelayMs?: number }} [options]
 * @returns {TabletService}
 */
export function registerHandlers(
  gladys,
  { client = createFreeKioskClient(), refreshDelayMs } = {},
) {
  const service = new TabletService(gladys, client, { refreshDelayMs });
  // A tablet changed (list, reachability, screen): re-pull the widgets.
  service.onChange = () => refreshWidgets(gladys);

  // Discovery tab: refresh the known tablets and scan the configured range.
  gladys.onScanRequest(async () => {
    logger.info('onScanRequest -> looking for FreeKiosk tablets');
    if (service.configError()) {
      // Still publish the known tablets: an invalid range must not hide them.
      await service.publishDiscoveredDevices();
      return;
    }
    await service.discover();
  });

  gladys.onPoll(async (device) => {
    await service.poll(device);
  });

  gladys.onSetValue((device, feature, value) => service.setValue(device, feature, value));

  gladys.onGetImage((device) => service.getImage(device));

  gladys.onDeviceCreated(async (device) => {
    // The new device accepts states and transports now: read it at once
    // instead of waiting for its first poll.
    const tablet = service.tabletFromExternalId(device.external_id);
    if (tablet) {
      await service.refresh(tablet).catch(() => undefined);
    }
    await service.publishAllTransports().catch(() => undefined);
  });

  gladys.onDeviceDeleted((device) => service.forget(device));

  for (const [key, handler] of Object.entries(MANIFEST_ACTIONS)) {
    gladys.onAction(key, (fields) => handler(service, fields ?? {}));
  }

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, async (fields) => {
      await handler(service, fields ?? {});
    });
  }

  // Dashboard widgets: content pulled by the core, button taps relayed.
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(service, request));
    gladys.onWidgetAction(key, (actionKey, params, { settings, values } = {}) =>
      widget.action(service, { actionKey, params: params ?? {}, settings, values }),
    );
  }

  gladys.onConfigUpdated(async (config) => {
    logger.info('onConfigUpdated -> configuration reloaded');
    service.load(config);
    await reportConfigStatus(gladys, service);
    await service.publishDiscoveredDevices();
    refreshWidgets(gladys);
  });

  gladys.on('connected', async () => {
    try {
      service.load(await gladys.getConfig());
      // Read every known tablet once, so the states and badges are fresh.
      await Promise.all(
        service.registry.list().map((t) => service.refresh(t).catch(() => undefined)),
      );
      await service.publishDiscoveredDevices();
      await reportConfigStatus(gladys, service);
      // The nudges sent while the socket was down were dropped.
      refreshWidgets(gladys);
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        })
        .catch(() => undefined);
    }
  });

  return service;
}

async function reportConfigStatus(gladys, service) {
  const error = service.configError();
  if (error) {
    await gladys.setConnectionStatus(false, error);
  } else {
    await gladys.setConnectionStatus(true);
  }
}
