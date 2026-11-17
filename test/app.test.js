// End-to-end tests of the integration: the real wiring (src/app.js) against
// the SDK's fake Gladys (which refuses the payloads Gladys refuses) and an
// in-memory LAN of FreeKiosk tablets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { TABLETS_CONFIG_KEY } from '../src/constants.js';
import { createFakeClient, sampleStatus } from './helpers/fakeTablets.js';

async function setup({ config = {}, tablets = {} } = {}) {
  const client = createFakeClient(tablets);
  const gladys = createFakeGladys({ config });
  const service = registerHandlers(gladys, { client, refreshDelayMs: 0 });
  await gladys.connect();
  return { gladys, client, service };
}

const ONE_TABLET = { '192.168.1.50:8080': { status: sampleStatus() } };

/** Simulate the user creating every discovered device in Gladys. */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
}

function storedTablets(gladys) {
  return JSON.parse(gladys.fake.config[TABLETS_CONFIG_KEY] ?? '[]');
}

test('the scan discovers a tablet and publishes a device Gladys accepts', async () => {
  const { gladys } = await setup({
    config: { scan_range: '192.168.1.40-192.168.1.60' },
    tablets: ONE_TABLET,
  });
  await gladys.fake.scanRequest();

  const [device] = gladys.fake.discoveredDevices;
  assert.ok(device, 'a device is discovered');
  assert.equal(device.name, 'FreeKiosk SM-T510');
  assert.equal(device.model, 'SM-T510');
  assert.equal(device.poll_frequency, 15000);
  assert.ok(device.params.some((p) => p.name === 'host' && p.value === '192.168.1.50'));
  assert.ok(device.features.some((f) => f.external_id.endsWith(':screen')));
  assert.ok(
    !device.features.some((f) => f.external_id.endsWith(':camera')),
    'camera off by default',
  );

  // The tablet is remembered under a generated id, not its IP.
  const [stored] = storedTablets(gladys);
  assert.equal(stored.host, '192.168.1.50');
  assert.equal(device.external_id, `ext:test-integration:freekiosk:${stored.id}`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('polling publishes the tablet states once created, at the configured pace', async () => {
  const { gladys, service } = await setup({
    config: { scan_range: '192.168.1.50' },
    tablets: ONE_TABLET,
  });
  await gladys.fake.scanRequest();
  await createAll(gladys);
  const [device] = gladys.fake.discoveredDevices;

  // Read as soon as the user created it.
  const id = device.external_id;
  assert.equal(gladys.fake.lastState(`${id}:battery`), 85);
  assert.equal(await service.poll(device, 1_000_000), true);
  assert.equal(gladys.fake.lastState(`${id}:battery`), 85);
  assert.equal(gladys.fake.lastState(`${id}:charging`), 1);
  assert.equal(gladys.fake.lastState(`${id}:screen`), 1);
  assert.equal(gladys.fake.lastState(`${id}:brightness`), 75);
  assert.equal(gladys.fake.lastState(`${id}:volume`), 50);
  assert.equal(gladys.fake.lastState(`${id}:light`), 150.5);
  assert.equal(gladys.fake.lastState(`${id}:current-url`), 'http://dashboard.local/');

  // Default refresh interval: 30 s.
  assert.equal(await service.poll(device, 1_000_000 + 10_000), false);
  assert.equal(await service.poll(device, 1_000_000 + 30_000), true);

  // Through the real onPoll handler too.
  assert.deepEqual(await gladys.fake.poll(device), { success: true });
});

test('commands reach the right REST endpoint and confirm the state', async () => {
  const { gladys, client } = await setup({
    config: { scan_range: '192.168.1.50', api_key: 'k' },
    tablets: { '192.168.1.50:8080': { status: sampleStatus(), apiKey: 'k' } },
  });
  await gladys.fake.scanRequest();
  await createAll(gladys);
  const [device] = gladys.fake.discoveredDevices;
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

  const cases = [
    ['screen', 0, '/api/screen/off', undefined],
    ['screen', 1, '/api/screen/on', undefined],
    ['brightness', 140, '/api/brightness', { value: 100 }],
    ['volume', 30, '/api/volume', { value: 30 }],
    ['auto-brightness', 1, '/api/autoBrightness/enable', undefined],
    ['screensaver', 1, '/api/screensaver/on', undefined],
    ['load-url', 'https://example.com', '/api/url', { url: 'https://example.com' }],
    ['tts', 'Bonjour', '/api/tts', { text: 'Bonjour' }],
    ['toast', 'Hello', '/api/toast', { text: 'Hello' }],
    ['reload', 1, '/api/reload', undefined],
    ['reboot', 1, '/api/reboot', undefined],
    ['beep', 1, '/api/audio/beep', undefined],
  ];
  for (const [key, value, path, body] of cases) {
    const ack = await gladys.fake.setValue(device, feature(key), value);
    assert.deepEqual(ack, { success: true }, `${key} acked`);
    const call = client.calls.filter((c) => c.type === 'command').at(-1);
    assert.equal(call.path, path, key);
    assert.deepEqual(call.body, body, key);
    assert.equal(call.target.apiKey, 'k');
  }
  assert.equal(gladys.fake.lastState(feature('brightness').external_id), 100);
  assert.equal(gladys.fake.lastState(feature('screensaver').external_id), 1);

  // A text command without text fails cleanly.
  const ack = await gladys.fake.setValue(device, feature('tts'), '   ');
  assert.equal(ack.success, false);
});

test('a tablet that stops answering is badged unreachable and fires the scene trigger', async () => {
  const { gladys, client, service } = await setup({
    config: { scan_range: '192.168.1.50' },
    tablets: ONE_TABLET,
  });
  await gladys.fake.scanRequest();
  await createAll(gladys);
  const [device] = gladys.fake.discoveredDevices;
  const tablet = service.registry.list()[0];

  await service.refresh(tablet);
  client.lan.get('192.168.1.50:8080').offline = true;
  await service.poll(device, 0);
  client.lan.get('192.168.1.50:8080').offline = false;
  await service.poll(device, 60_000);

  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.data?.status ?? e.status),
    ['offline', 'online'],
  );
  const transports = gladys.fake.transports.flat?.() ?? gladys.fake.transports;
  assert.ok(JSON.stringify(transports).includes('unreachable'));
});

test('a known tablet found at a new address keeps its device', async () => {
  const { gladys, client, service } = await setup({
    config: { scan_range: '192.168.1.50-192.168.1.60' },
    tablets: ONE_TABLET,
  });
  await gladys.fake.scanRequest();
  await createAll(gladys);
  const before = gladys.fake.discoveredDevices[0].external_id;

  // DHCP gave the tablet a new address.
  const moved = client.lan.get('192.168.1.50:8080');
  client.lan.delete('192.168.1.50:8080');
  client.lan.set('192.168.1.57:8080', moved);
  await service.poll(gladys.fake.discoveredDevices[0], 0); // now seen offline

  const message = await gladys.fake.action('scan_now', {});
  assert.equal(message.success, true);
  assert.match(message.data.message.en, /1 moved/);
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  assert.equal(gladys.fake.discoveredDevices[0].external_id, before);
  assert.equal(storedTablets(gladys)[0].host, '192.168.1.57');
});

test('add a tablet by IP, with its own API key', async () => {
  const { gladys } = await setup({
    tablets: { '10.0.0.8:8090': { status: sampleStatus(), apiKey: 'own-key' } },
  });

  let ack = await gladys.fake.action('add_tablet', { host: '10.0.0.8', port: 8090 });
  assert.match(ack.data.message.en, /refused the API key/);

  ack = await gladys.fake.action('add_tablet', { host: '10.0.0.9' });
  assert.match(ack.data.message.en, /No FreeKiosk tablet answered/);

  ack = await gladys.fake.action('add_tablet', {
    host: '10.0.0.8',
    port: 8090,
    api_key: 'own-key',
    name: 'Hall',
  });
  assert.match(ack.data.message.en, /"Hall" found/);
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Hall');
  const [stored] = storedTablets(gladys);
  assert.equal(stored.apiKey, 'own-key');
  assert.equal(stored.port, 8090);
});

test('set a tablet API key and change its address keep the same device', async () => {
  const { gladys, client } = await setup({
    config: { scan_range: '192.168.1.50' },
    tablets: { '192.168.1.50:8080': { status: sampleStatus(), apiKey: 'k1' } },
  });
  await gladys.fake.scanRequest(); // found, but the key is unknown
  await createAll(gladys);
  const [device] = gladys.fake.discoveredDevices;

  let ack = await gladys.fake.action('set_api_key', { device: device.external_id, api_key: 'k1' });
  assert.match(ack.data.message.en, /answers/);

  const tablet = client.lan.get('192.168.1.50:8080');
  client.lan.set('192.168.1.99:8080', tablet);
  ack = await gladys.fake.action('update_address', {
    device: device.external_id,
    host: '192.168.1.99',
  });
  assert.match(ack.data.message.en, /answers at 192\.168\.1\.99:8080/);
  assert.equal(gladys.fake.discoveredDevices[0].external_id, device.external_id);
  assert.equal(storedTablets(gladys)[0].host, '192.168.1.99');
});

test('identify wakes the tablet, beeps and shows a message', async () => {
  const { gladys, client } = await setup({
    config: { scan_range: '192.168.1.50' },
    tablets: ONE_TABLET,
  });
  await gladys.fake.scanRequest();
  const [device] = gladys.fake.discoveredDevices;
  const ack = await gladys.fake.action('identify', { device: device.external_id });
  assert.match(ack.data.message.en, /beeps/);
  assert.deepEqual(
    client.calls.filter((c) => c.type === 'command').map((c) => c.path),
    ['/api/wake', '/api/audio/beep', '/api/toast'],
  );
});

test('scene actions call the tablet with their parameters', async () => {
  const { gladys, client } = await setup({
    config: { scan_range: '192.168.1.50' },
    tablets: ONE_TABLET,
  });
  await gladys.fake.scanRequest();
  const device = gladys.fake.discoveredDevices[0].external_id;

  await gladys.fake.sceneAction('speak', { device, text: 'Bonjour', language: 'fr-FR' });
  await gladys.fake.sceneAction('play_audio', { device, url: 'http://x/a.mp3', volume: 150 });
  await gladys.fake.sceneAction('load_url', { device, url: 'https://example.com' });
  await gladys.fake.sceneAction('show_message', { device, text: 'Hi' });
  await gladys.fake.sceneAction('stop_audio', { device });
  const commands = client.calls.filter((c) => c.type === 'command');
  assert.deepEqual(
    commands.map((c) => [c.path, c.body]),
    [
      ['/api/tts', { text: 'Bonjour', language: 'fr-FR' }],
      ['/api/audio/play', { url: 'http://x/a.mp3', loop: false, volume: 100 }],
      ['/api/url', { url: 'https://example.com' }],
      ['/api/toast', { text: 'Hi' }],
      ['/api/audio/stop', undefined],
    ],
  );

  const ack = await gladys.fake.sceneAction('speak', {
    device: 'ext:test-integration:freekiosk:nope',
    text: 'x',
  });
  assert.equal(ack.success, false);
});

test('the camera feature serves a photo under 150 KB, lowering the quality if needed', async () => {
  const photo = (quality) => Buffer.alloc(quality >= 30 ? 200 * 1024 : 50 * 1024, 1);
  const { gladys, client } = await setup({
    config: { scan_range: '192.168.1.50', camera: 'front' },
    tablets: { '192.168.1.50:8080': { status: sampleStatus(), photo } },
  });
  await gladys.fake.scanRequest();
  const [device] = gladys.fake.discoveredDevices;
  assert.ok(device.features.some((f) => f.external_id.endsWith(':camera')));

  const ack = await gladys.fake.getImage(device);
  assert.equal(ack.success, true);
  assert.match(ack.data.image ?? ack.data, /^image\/jpg;base64,/);
  assert.deepEqual(
    client.calls.filter((c) => c.type === 'photo').map((c) => [c.camera, c.quality]),
    [
      ['front', 50],
      ['front', 30],
      ['front', 15],
    ],
  );
});

async function cameraSetup(config = {}) {
  const photo = (quality) => Buffer.alloc(quality >= 30 ? 200 * 1024 : 50 * 1024, quality);
  const ctx = await setup({
    config: { scan_range: '192.168.1.50', camera: 'back', ...config },
    tablets: { '192.168.1.50:8080': { status: sampleStatus(), photo } },
  });
  await ctx.gladys.fake.scanRequest();
  await createAll(ctx.gladys);
  let clock = 1_000_000;
  ctx.service.now = () => clock;
  ctx.advance = (ms) => {
    clock += ms;
  };
  ctx.photos = () => ctx.client.calls.filter((c) => c.type === 'photo').map((c) => c.quality);
  return ctx;
}

test('a recent photo is reused instead of waking the camera again', async () => {
  const { gladys, advance, photos } = await cameraSetup();
  const [device] = gladys.fake.discoveredDevices;

  const first = await gladys.fake.getImage(device);
  assert.deepEqual(photos(), [50, 30, 15]);

  // Within the 60 s default: same image, no capture at all.
  advance(59_000);
  const again = await gladys.fake.getImage(device);
  assert.deepEqual(again, first);
  assert.deepEqual(photos(), [50, 30, 15]);

  // Expired: one new capture, straight at the quality that fitted last time.
  advance(2_000);
  await gladys.fake.getImage(device);
  assert.deepEqual(photos(), [50, 30, 15, 15]);
});

test('simultaneous requests share one capture, and 0 disables the reuse', async () => {
  const { gladys, service, photos } = await cameraSetup({ camera_cache_seconds: 0 });
  const [device] = gladys.fake.discoveredDevices;
  const tablet = service.registry.list()[0];

  const [a, b] = await Promise.all([service.capturePhoto(tablet), service.capturePhoto(tablet)]);
  assert.equal(a, b);
  assert.deepEqual(photos(), [50, 30, 15]);

  await gladys.fake.getImage(device);
  assert.deepEqual(photos(), [50, 30, 15, 15]);
});

test('the take_photo scene action takes a new photo and publishes it on the camera', async () => {
  const { gladys, photos } = await cameraSetup();
  const [device] = gladys.fake.discoveredDevices;
  await gladys.fake.getImage(device); // cached...

  const ack = await gladys.fake.sceneAction('take_photo', { device: device.external_id });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.deepEqual(photos(), [50, 30, 15, 15], '...but an explicit request ignores the cache');
  assert.equal(gladys.fake.cameraImages.length, 1);
  assert.match(JSON.stringify(gladys.fake.cameraImages[0]), /image\/jpg;base64,/);
  assert.ok(JSON.stringify(gladys.fake.cameraImages[0]).includes(device.external_id));
});

test('the camera disabled refuses to take a photo', async () => {
  const { gladys } = await setup({ config: { scan_range: '192.168.1.50' }, tablets: ONE_TABLET });
  await gladys.fake.scanRequest();
  const [device] = gladys.fake.discoveredDevices;
  const ack = await gladys.fake.sceneAction('take_photo', { device: device.external_id });
  assert.equal(ack.success, false);
  assert.match(ack.error, /camera is disabled/);
});

test('deleting a device forgets the tablet', async () => {
  const { gladys } = await setup({ config: { scan_range: '192.168.1.50' }, tablets: ONE_TABLET });
  await gladys.fake.scanRequest();
  await createAll(gladys);
  await gladys.fake.deviceDeleted(gladys.fake.discoveredDevices[0]);
  assert.deepEqual(storedTablets(gladys), []);
});

test('an invalid scan range is reported in the connection status', async () => {
  const { gladys } = await setup({ config: { scan_range: '10.0.0.0/8' } });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Plage de scan invalide/);
  // The Discovery tab still works (publishes the known tablets: none).
  await gladys.fake.scanRequest();
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});
