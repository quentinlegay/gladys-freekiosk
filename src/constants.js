// -----------------------------------------------------------------------------
// FreeKiosk integration constants.
//
// The REST endpoints come from the FreeKiosk documentation
// (https://github.com/RushB-fr/freekiosk/blob/main/docs/rest-api.md) and from
// the app's own HTTP server (KioskHttpServer.kt). Every key of FEATURE is part
// of a feature external id: it is forever, never rename one.
// -----------------------------------------------------------------------------

// Device "type" segment of the external ids: ext:<selector>:freekiosk:<id>.
export const DEVICE_TYPE = 'freekiosk';

export const DEFAULT_PORT = 8080;

// A sleeping tablet can take a few seconds to answer, but a scene must not hang
// on an unplugged one.
export const REQUEST_TIMEOUT_MS = 8000;

// The camera needs 1-2 s to initialize and adjust its exposure.
export const PHOTO_TIMEOUT_MS = 12000;

// A LAN host answers in a few ms; an empty address times out. Short enough for a
// /24 to be scanned in seconds, long enough for a Wi-Fi tablet in power saving.
export const SCAN_TIMEOUT_MS = 1500;
export const SCAN_CONCURRENCY = 64;
// Upper bound of the addresses one scan may probe (a /22).
export const SCAN_MAX_HOSTS = 1024;

// Gladys accepts at most 150 KB per camera image (the base64 string).
export const MAX_CAMERA_IMAGE_LENGTH = 150 * 1024;
// JPEG qualities tried in turn until the photo fits under the limit.
export const CAMERA_QUALITIES = [50, 30, 15, 8];

// Feature keys: the last segment of every feature external id.
export const FEATURE = {
  SCREEN: 'screen',
  SCREENSAVER: 'screensaver',
  BRIGHTNESS: 'brightness',
  AUTO_BRIGHTNESS: 'auto-brightness',
  VOLUME: 'volume',
  BATTERY: 'battery',
  CHARGING: 'charging',
  BATTERY_TEMPERATURE: 'battery-temperature',
  LIGHT: 'light',
  CURRENT_URL: 'current-url',
  LOAD_URL: 'load-url',
  TTS: 'tts',
  TOAST: 'toast',
  RELOAD: 'reload',
  WAKE: 'wake',
  CLEAR_CACHE: 'clear-cache',
  RESTART_UI: 'restart-ui',
  REBOOT: 'reboot',
  LOCK: 'lock',
  BEEP: 'beep',
  CAMERA: 'camera',
};

// FreeKiosk REST endpoints.
export const API = {
  ROOT: '/',
  STATUS: '/api/status',
  SCREEN_ON: '/api/screen/on',
  SCREEN_OFF: '/api/screen/off',
  SCREENSAVER_ON: '/api/screensaver/on',
  SCREENSAVER_OFF: '/api/screensaver/off',
  BRIGHTNESS: '/api/brightness',
  AUTO_BRIGHTNESS_ENABLE: '/api/autoBrightness/enable',
  AUTO_BRIGHTNESS_DISABLE: '/api/autoBrightness/disable',
  VOLUME: '/api/volume',
  URL: '/api/url',
  TTS: '/api/tts',
  TOAST: '/api/toast',
  RELOAD: '/api/reload',
  WAKE: '/api/wake',
  CLEAR_CACHE: '/api/clearCache',
  RESTART_UI: '/api/restart-ui',
  REBOOT: '/api/reboot',
  LOCK: '/api/lock',
  BEEP: '/api/audio/beep',
  AUDIO_PLAY: '/api/audio/play',
  AUDIO_STOP: '/api/audio/stop',
  CAMERA_PHOTO: '/api/camera/photo',
};

// Values of the `camera` config field.
export const CAMERA_MODE = {
  DISABLED: 'disabled',
  FRONT: 'front',
  BACK: 'back',
};

// Config key stored OUTSIDE the config_schema (never shown in the form): the
// list of known tablets, as a JSON string (see src/registry.js).
export const TABLETS_CONFIG_KEY = 'tablets_json';

// Scene trigger fired when a tablet stops or starts answering.
export const SCENE_TRIGGER_AVAILABILITY = 'tablet_availability_changed';
export const AVAILABILITY = { ONLINE: 'online', OFFLINE: 'offline' };
