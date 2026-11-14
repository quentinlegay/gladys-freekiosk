// -----------------------------------------------------------------------------
// Tablet <-> Gladys device conversion.
//
//   - buildDevice: the discovery payload of one tablet;
//   - normalizeStatus / buildStates: `GET /api/status` -> Gladys states;
//   - commandFor: a Gladys command (feature + value) -> FreeKiosk REST call.
//
// External ids: ext:<selector>:freekiosk:<tablet id>[:<feature key>], the
// tablet id being the one of the registry (see src/registry.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { API, CAMERA_MODE, DEVICE_TYPE, FEATURE } from './constants.js';

// Gladys polls each tablet every 15 s; the slower `poll_frequency` of the
// config is applied by skipping polls (see TabletService.poll), so the user
// can change it without re-creating the devices.
export const DEVICE_POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_15_SECONDS;

export function tabletIds(gladys, tablet) {
  return gladys.externalIds(DEVICE_TYPE, tablet.id);
}

/** Tablet id from a device or feature external id, or undefined. */
export function tabletIdFromExternalId(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return undefined;
  }
  return externalId.slice(prefix.length).split(':')[0] || undefined;
}

export function featureKeyFromExternalId(externalId) {
  const parts = String(externalId).split(':');
  return parts[parts.length - 1];
}

export function tabletName(tablet) {
  return tablet.name || `FreeKiosk ${tablet.host}`;
}

const binary = (name, key, category, type, extra = {}) => ({
  name,
  key,
  category,
  type,
  min: 0,
  max: 1,
  ...extra,
});

/**
 * The feature catalog. Order = display order in Gladys. The camera feature is
 * only added when the config enables one (features are read once, when the
 * user creates the device).
 */
function featureCatalog(config) {
  const features = [
    binary('Screen', FEATURE.SCREEN, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY, {
      read_only: false,
      has_feedback: true,
      keep_history: true,
    }),
    binary('Screensaver', FEATURE.SCREENSAVER, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY, {
      read_only: false,
      has_feedback: true,
      keep_history: false,
    }),
    {
      name: 'Brightness',
      key: FEATURE.BRIGHTNESS,
      category: CATEGORIES.SWITCH,
      type: TYPES.SWITCH.DIMMER,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: true,
      keep_history: false,
    },
    binary('Auto brightness', FEATURE.AUTO_BRIGHTNESS, CATEGORIES.SWITCH, TYPES.SWITCH.BINARY, {
      read_only: false,
      has_feedback: true,
      keep_history: false,
    }),
    {
      name: 'Volume',
      key: FEATURE.VOLUME,
      category: CATEGORIES.MUSIC,
      type: TYPES.MUSIC.VOLUME,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      has_feedback: true,
      keep_history: false,
    },
    {
      name: 'Battery',
      key: FEATURE.BATTERY,
      category: CATEGORIES.BATTERY,
      type: TYPES.BATTERY.INTEGER,
      unit: UNITS.PERCENT,
      min: 0,
      max: 100,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
    binary('Charging', FEATURE.CHARGING, CATEGORIES.BATTERY, TYPES.BATTERY.CHARGING, {
      read_only: true,
      has_feedback: false,
      keep_history: true,
    }),
    {
      name: 'Battery temperature',
      key: FEATURE.BATTERY_TEMPERATURE,
      category: CATEGORIES.DEVICE_TEMPERATURE_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.CELSIUS,
      min: -20,
      max: 100,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
    {
      name: 'Ambient light',
      key: FEATURE.LIGHT,
      category: CATEGORIES.LIGHT_SENSOR,
      type: TYPES.SENSOR.DECIMAL,
      unit: UNITS.LUX,
      min: 0,
      max: 100000,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
    // Gladys' min/max are mandatory on every feature, meaningless on text.
    binary('Current page', FEATURE.CURRENT_URL, CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
      read_only: true,
      has_feedback: false,
      keep_history: false,
    }),
    binary('Open a URL', FEATURE.LOAD_URL, CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
      read_only: false,
      has_feedback: false,
      keep_history: false,
    }),
    binary('Speak (text to speech)', FEATURE.TTS, CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
      read_only: false,
      has_feedback: false,
      keep_history: false,
    }),
    binary('Show a message', FEATURE.TOAST, CATEGORIES.TEXT, TYPES.TEXT.TEXT, {
      read_only: false,
      has_feedback: false,
      keep_history: false,
    }),
  ];

  const buttons = [
    ['Reload the page', FEATURE.RELOAD],
    ['Wake up', FEATURE.WAKE],
    ['Clear the cache', FEATURE.CLEAR_CACHE],
    ['Restart FreeKiosk', FEATURE.RESTART_UI],
    ['Lock the screen', FEATURE.LOCK],
    ['Reboot the tablet', FEATURE.REBOOT],
    ['Beep', FEATURE.BEEP],
  ];
  for (const [name, key] of buttons) {
    features.push(
      binary(name, key, CATEGORIES.BUTTON, TYPES.BUTTON.PUSH, {
        read_only: false,
        has_feedback: false,
        keep_history: false,
      }),
    );
  }

  if (config?.camera === CAMERA_MODE.FRONT || config?.camera === CAMERA_MODE.BACK) {
    features.push(
      binary('Camera', FEATURE.CAMERA, CATEGORIES.CAMERA, TYPES.CAMERA.IMAGE, {
        read_only: true,
        has_feedback: false,
        keep_history: false,
      }),
    );
  }
  return features;
}

/**
 * Discovery payload of one tablet.
 * @param {object} gladys SDK instance (external ids)
 * @param {object} tablet registry entry
 * @param {object} config normalized config
 * @param {object} [status] normalized status, when the tablet answered
 */
export function buildDevice(gladys, tablet, config, status) {
  const ids = tabletIds(gladys, tablet);
  const name = tabletName(tablet);
  const params = [
    { name: 'host', value: tablet.host },
    { name: 'port', value: String(tablet.port) },
  ];
  const info = status?.device ?? {};
  for (const [param, value] of [
    ['manufacturer', info.manufacturer ?? tablet.manufacturer],
    ['android_version', info.androidVersion],
    ['freekiosk_version', info.version],
    ['device_owner', info.isDeviceOwner === undefined ? undefined : String(info.isDeviceOwner)],
  ]) {
    if (value !== undefined && value !== null && value !== '') {
      params.push({ name: param, value: String(value) });
    }
  }

  return {
    name,
    external_id: ids.device,
    model: info.model ?? tablet.model ?? 'FreeKiosk',
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCY,
    params,
    features: featureCatalog(config).map(({ key, name: featureName, ...feature }) => ({
      name: `${name} - ${featureName}`,
      external_id: ids.feature(key),
      ...feature,
    })),
  };
}

const asNumber = (value) =>
  value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? undefined
    : Number(value);
const asBool = (value) => (typeof value === 'boolean' ? value : undefined);

/**
 * Normalize a `GET /api/status` payload: every field optional, read
 * defensively (the payload evolves with the FreeKiosk versions).
 */
export function normalizeStatus(data) {
  const d = data ?? {};
  const device = d.device ?? {};
  return {
    screenOn: asBool(d.screen?.on),
    screensaverActive: asBool(d.screen?.screensaverActive),
    brightness: asNumber(d.screen?.brightness),
    autoBrightness: asBool(d.autoBrightness?.enabled),
    volume: asNumber(d.audio?.volume),
    batteryLevel: asNumber(d.battery?.level),
    charging: asBool(d.battery?.charging),
    batteryTemperature: asNumber(d.battery?.temperature),
    light: asNumber(d.sensors?.light),
    currentUrl: typeof d.webview?.currentUrl === 'string' ? d.webview.currentUrl : undefined,
    device: {
      model: device.model,
      manufacturer: device.manufacturer,
      androidVersion: device.androidVersion ?? device.android,
      version: device.version,
      isDeviceOwner: asBool(device.isDeviceOwner),
      kioskMode: asBool(device.kioskMode),
    },
  };
}

/** The states to publish from a normalized status (present fields only). */
export function buildStates(gladys, tablet, status) {
  const ids = tabletIds(gladys, tablet);
  const states = [];
  const push = (key, state) => {
    if (state !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state });
    }
  };
  const bool = (value) => (value === undefined ? undefined : value ? 1 : 0);
  // The light sensor reports -1 when the tablet has none.
  const light = status.light !== undefined && status.light >= 0 ? status.light : undefined;

  push(FEATURE.SCREEN, bool(status.screenOn));
  push(FEATURE.SCREENSAVER, bool(status.screensaverActive));
  push(FEATURE.BRIGHTNESS, status.brightness);
  push(FEATURE.AUTO_BRIGHTNESS, bool(status.autoBrightness));
  push(FEATURE.VOLUME, status.volume);
  push(FEATURE.BATTERY, status.batteryLevel);
  push(FEATURE.CHARGING, bool(status.charging));
  push(FEATURE.BATTERY_TEMPERATURE, status.batteryTemperature);
  push(FEATURE.LIGHT, light);
  if (status.currentUrl) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.CURRENT_URL),
      text: status.currentUrl,
    });
  }
  return states;
}

const clampPercent = (value) => Math.round(Math.min(100, Math.max(0, Number(value))));

function requireText(value, what) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(`${what} is empty`);
  }
  return text;
}

/**
 * Translate a Gladys command into a FreeKiosk REST call.
 * @returns {{ path: string, body?: object, confirmed?: number }} `confirmed`
 *   is the state to publish once the tablet accepted the command (for the
 *   features with feedback), before the next poll confirms it.
 */
export function commandFor(featureKey, value) {
  const on = Number(value) === 1;
  switch (featureKey) {
    case FEATURE.SCREEN:
      return { path: on ? API.SCREEN_ON : API.SCREEN_OFF, confirmed: on ? 1 : 0 };
    case FEATURE.SCREENSAVER:
      return { path: on ? API.SCREENSAVER_ON : API.SCREENSAVER_OFF, confirmed: on ? 1 : 0 };
    case FEATURE.AUTO_BRIGHTNESS:
      return {
        path: on ? API.AUTO_BRIGHTNESS_ENABLE : API.AUTO_BRIGHTNESS_DISABLE,
        confirmed: on ? 1 : 0,
      };
    case FEATURE.BRIGHTNESS: {
      const level = clampPercent(value);
      return { path: API.BRIGHTNESS, body: { value: level }, confirmed: level };
    }
    case FEATURE.VOLUME: {
      const level = clampPercent(value);
      return { path: API.VOLUME, body: { value: level }, confirmed: level };
    }
    case FEATURE.LOAD_URL:
      return { path: API.URL, body: { url: requireText(value, 'The URL') } };
    case FEATURE.TTS:
      return { path: API.TTS, body: { text: requireText(value, 'The text') } };
    case FEATURE.TOAST:
      return { path: API.TOAST, body: { text: requireText(value, 'The message') } };
    case FEATURE.RELOAD:
      return { path: API.RELOAD };
    case FEATURE.WAKE:
      return { path: API.WAKE };
    case FEATURE.CLEAR_CACHE:
      return { path: API.CLEAR_CACHE };
    case FEATURE.RESTART_UI:
      return { path: API.RESTART_UI };
    case FEATURE.LOCK:
      return { path: API.LOCK };
    case FEATURE.REBOOT:
      return { path: API.REBOOT };
    case FEATURE.BEEP:
      return { path: API.BEEP };
    default:
      throw new Error(`The feature "${featureKey}" cannot be controlled`);
  }
}
