// -----------------------------------------------------------------------------
// Integration configuration: defaults (they MUST mirror the `default` values of
// the manifest `config_schema`) and normalization, so the rest of the code
// never deals with `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

import { CAMERA_MODE, DEFAULT_PORT } from './constants.js';

export const DEFAULT_CONFIG = {
  // API key shared by the tablets (FreeKiosk > Advanced > REST API). A tablet
  // can override it with the "Set a tablet's API key" action.
  api_key: '',
  // Port of the FreeKiosk REST server, used by the network scan and as the
  // default of the "Add a tablet" action.
  default_port: DEFAULT_PORT,
  // Addresses scanned for tablets: CIDR blocks, ranges or single IPs,
  // comma-separated. Empty = no scan, tablets are added by IP.
  scan_range: '',
  // Seconds between two status reads of a tablet.
  poll_frequency: 30,
  // Camera exposed as a Gladys camera device feature: disabled, front or back.
  camera: CAMERA_MODE.DISABLED,
  // Seconds during which a photo is served again instead of taking a new one
  // (battery). 0 = a new photo on every request.
  camera_cache_seconds: 60,
};

const CAMERA_MODES = new Set(Object.values(CAMERA_MODE));

function toNumber(value, fallback, { min, max } = {}) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, number));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = raw ?? {};
  return {
    ...DEFAULT_CONFIG,
    ...config,
    api_key: typeof config.api_key === 'string' ? config.api_key.trim() : '',
    default_port: toNumber(config.default_port, DEFAULT_CONFIG.default_port, {
      min: 1,
      max: 65535,
    }),
    scan_range: typeof config.scan_range === 'string' ? config.scan_range.trim() : '',
    poll_frequency: toNumber(config.poll_frequency, DEFAULT_CONFIG.poll_frequency, {
      min: 15,
      max: 3600,
    }),
    camera: CAMERA_MODES.has(config.camera) ? config.camera : DEFAULT_CONFIG.camera,
    camera_cache_seconds: toNumber(
      config.camera_cache_seconds,
      DEFAULT_CONFIG.camera_cache_seconds,
      {
        min: 0,
        max: 3600,
      },
    ),
  };
}
