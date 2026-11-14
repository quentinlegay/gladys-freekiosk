// -----------------------------------------------------------------------------
// Registry of the known tablets.
//
// FreeKiosk's REST API exposes no unique hardware identifier (no serial, no
// MAC, no Android ID), and an IP address is not one either (DHCP). So each
// tablet gets an identifier generated once, when it is first found, and kept
// for life in the integration config (off-schema key, see TABLETS_CONFIG_KEY):
// that identifier, never the address, builds the Gladys external ids. The
// address can then change (the "Change a tablet's address" action, or the
// automatic follow-up of a tablet found at a new address by the scan) without
// orphaning the device, its history or its scenes.
//
// One entry: { id, host, port, apiKey?, name?, model?, manufacturer? }.
// -----------------------------------------------------------------------------

import crypto from 'node:crypto';
import { TABLETS_CONFIG_KEY } from './constants.js';

export function parseTablets(raw) {
  if (!raw) {
    return [];
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed)
      ? parsed.filter((t) => t && typeof t.id === 'string' && typeof t.host === 'string')
      : [];
  } catch {
    return [];
  }
}

export function generateTabletId() {
  return crypto.randomBytes(6).toString('hex');
}

export function normalizeHost(host) {
  return String(host ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export class TabletRegistry {
  constructor(tablets = []) {
    this.tablets = tablets.map((t) => ({ ...t }));
  }

  static fromConfig(config) {
    return new TabletRegistry(parseTablets(config?.[TABLETS_CONFIG_KEY]));
  }

  list() {
    return [...this.tablets];
  }

  get(id) {
    return this.tablets.find((t) => t.id === id);
  }

  findByAddress(host, port) {
    const wanted = normalizeHost(host);
    return this.tablets.find((t) => normalizeHost(t.host) === wanted && t.port === port);
  }

  /** Add a tablet (or return the one already at this address). */
  add({ host, port, ...rest }) {
    const existing = this.findByAddress(host, port);
    if (existing) {
      Object.assign(existing, definedOnly(rest));
      return { tablet: existing, created: false };
    }
    const tablet = {
      id: generateTabletId(),
      host: normalizeHost(host),
      port,
      ...definedOnly(rest),
    };
    this.tablets.push(tablet);
    return { tablet, created: true };
  }

  update(id, changes) {
    const tablet = this.get(id);
    if (!tablet) {
      return undefined;
    }
    Object.assign(tablet, definedOnly(changes));
    if (changes.host !== undefined) {
      tablet.host = normalizeHost(changes.host);
    }
    return tablet;
  }

  remove(id) {
    const before = this.tablets.length;
    this.tablets = this.tablets.filter((t) => t.id !== id);
    return this.tablets.length !== before;
  }

  /**
   * The scan found a FreeKiosk tablet at an address nobody knows: is it a
   * known tablet whose IP changed? Only when exactly one known tablet is
   * currently unreachable and has the same model and manufacturer — never a
   * guess between two identical candidates.
   * @param {{ model?: string, manufacturer?: string }} identity
   * @param {(tablet) => boolean} isOffline
   */
  findMovedCandidate(identity, isOffline) {
    if (!identity?.model) {
      return undefined;
    }
    const candidates = this.tablets.filter(
      (t) => isOffline(t) && t.model === identity.model && t.manufacturer === identity.manufacturer,
    );
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  /** The partial config to save with `gladys.setConfig`. */
  toConfig() {
    return { [TABLETS_CONFIG_KEY]: JSON.stringify(this.tablets) };
  }
}

function definedOnly(object) {
  return Object.fromEntries(
    Object.entries(object ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}
