// A fake FreeKiosk client for the tests: an in-memory LAN of tablets, keyed
// by "host:port", with the same interface as src/freekioskClient.js. Tests
// never touch the network.

import { FreeKioskError } from '../../src/freekioskClient.js';

export function sampleStatus(overrides = {}) {
  return {
    battery: { level: 85, charging: true, temperature: 25.5 },
    screen: { on: true, brightness: 75, screensaverActive: false },
    webview: { currentUrl: 'http://dashboard.local/', canGoBack: false, loading: false },
    device: {
      model: 'SM-T510',
      manufacturer: 'samsung',
      androidVersion: '11',
      version: '2.1.0',
      isDeviceOwner: true,
      kioskMode: true,
      ip: '192.168.1.50',
    },
    wifi: { connected: true, ssid: 'Home' },
    sensors: { light: 150.5, proximity: 5 },
    autoBrightness: { enabled: false, min: 10, max: 100 },
    audio: { volume: 50 },
    ...overrides,
  };
}

export function createFakeClient(tablets = {}) {
  const lan = new Map(Object.entries(tablets));
  const calls = [];

  function lookup(target) {
    const tablet = lan.get(`${target.host}:${target.port}`);
    if (!tablet || tablet.offline) {
      throw new FreeKioskError('ECONNREFUSED', { code: 'UNREACHABLE' });
    }
    if (tablet.apiKey && tablet.apiKey !== target.apiKey) {
      throw new FreeKioskError('invalid or missing API key', {
        status: 401,
        code: 'UNAUTHORIZED',
      });
    }
    return tablet;
  }

  return {
    lan,
    calls,
    async probe({ host, port }) {
      calls.push({ type: 'probe', host, port });
      const tablet = lan.get(`${host}:${port}`);
      if (!tablet || tablet.offline) {
        return null;
      }
      return { authRequired: Boolean(tablet.apiKey) };
    },
    async getStatus(target) {
      calls.push({ type: 'status', target });
      return lookup(target).status;
    },
    async command(target, path, body) {
      calls.push({ type: 'command', target, path, body });
      lookup(target);
      return { executed: true };
    },
    async getPhoto(target, { camera, quality }) {
      calls.push({ type: 'photo', target, camera, quality });
      const tablet = lookup(target);
      return tablet.photo(quality);
    },
  };
}
