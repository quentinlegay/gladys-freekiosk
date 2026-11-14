// -----------------------------------------------------------------------------
// Network scan: probe a list of IPv4 addresses for a FreeKiosk REST server.
//
// The integration runs in a bridge Docker container: it cannot see the LAN
// broadcast domain (and FreeKiosk announces nothing on mDNS anyway), but plain
// outbound TCP to the LAN works. So the user gives the address range to scan,
// and each address is asked over HTTP whether it is a FreeKiosk tablet.
// -----------------------------------------------------------------------------

import { SCAN_CONCURRENCY, SCAN_MAX_HOSTS } from './constants.js';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipToInt(ip) {
  const match = IPV4.exec(ip.trim());
  if (!match) {
    return null;
  }
  const bytes = match.slice(1).map(Number);
  if (bytes.some((b) => b > 255)) {
    return null;
  }
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
}

export function intToIp(value) {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
}

function parseEntry(entry) {
  // CIDR block: 192.168.1.0/24 -> the usable hosts (network and broadcast
  // addresses excluded, except for /31 and /32).
  const cidr = /^([\d.]+)\/(\d{1,2})$/.exec(entry);
  if (cidr) {
    const base = ipToInt(cidr[1]);
    const bits = Number(cidr[2]);
    if (base === null || bits > 32) {
      throw new Error(`invalid CIDR block "${entry}"`);
    }
    if (bits < 22) {
      throw new Error(`"${entry}" is too large: use a /22 or smaller block`);
    }
    const size = 2 ** (32 - bits);
    const network = bits === 0 ? 0 : (base & (~0 << (32 - bits))) >>> 0;
    if (size <= 2) {
      return { start: network, end: network + size - 1 };
    }
    return { start: network + 1, end: network + size - 2 };
  }
  // Range: 192.168.1.10-192.168.1.60, or 192.168.1.10-60.
  const range = /^([\d.]+)\s*-\s*([\d.]+)$/.exec(entry);
  if (range) {
    const start = ipToInt(range[1]);
    let end = ipToInt(range[2]);
    if (end === null && /^\d{1,3}$/.test(range[2]) && start !== null) {
      end = ((start & 0xffffff00) | Number(range[2])) >>> 0;
    }
    if (start === null || end === null || end < start || Number(range[2]) > 255) {
      throw new Error(`invalid address range "${entry}"`);
    }
    return { start, end };
  }
  const single = ipToInt(entry);
  if (single === null) {
    throw new Error(`invalid address "${entry}"`);
  }
  return { start: single, end: single };
}

/**
 * Expand the `scan_range` config value into the list of addresses to probe.
 * Accepts CIDR blocks, ranges and single addresses, comma or space separated.
 * Throws a readable error on an invalid or too large value.
 * @param {string} value e.g. "192.168.1.0/24, 10.0.0.20-10.0.0.40"
 * @returns {string[]}
 */
export function parseScanRange(value) {
  const entries = (value ?? '')
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const hosts = new Set();
  for (const entry of entries) {
    const { start, end } = parseEntry(entry);
    if (hosts.size + (end - start + 1) > SCAN_MAX_HOSTS) {
      throw new Error(`the scan range holds more than ${SCAN_MAX_HOSTS} addresses`);
    }
    for (let ip = start; ip <= end; ip += 1) {
      hosts.add(intToIp(ip));
    }
  }
  return [...hosts];
}

/**
 * Probe every address with at most `concurrency` requests in flight, and
 * resolve the addresses where a FreeKiosk server answered.
 * @param {string[]} hosts
 * @param {(host: string) => Promise<object | null>} probe
 * @returns {Promise<Array<{ host: string } & object>>}
 */
export async function scanHosts(hosts, probe, { concurrency = SCAN_CONCURRENCY } = {}) {
  const found = [];
  let next = 0;
  async function worker() {
    while (next < hosts.length) {
      const host = hosts[next];
      next += 1;
      const result = await probe(host).catch(() => null);
      if (result) {
        found.push({ host, ...result });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  // Stable order whatever answered first.
  return found.sort((a, b) => (ipToInt(a.host) ?? 0) - (ipToInt(b.host) ?? 0));
}
