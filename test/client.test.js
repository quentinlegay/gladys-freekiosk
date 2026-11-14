// The REST client against a stubbed fetch: no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFreeKioskClient } from '../src/freekioskClient.js';

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function stubFetch(handler) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), ...options });
    return handler(String(url), options);
  };
  return { fetchImpl, requests };
}

const target = { host: '192.168.1.50', port: 8080, apiKey: 'secret' };

test('getStatus sends the API key in a header, never in the URL, and resolves data', async () => {
  const { fetchImpl, requests } = stubFetch(() =>
    jsonResponse(200, { success: true, data: { battery: { level: 42 } } }),
  );
  const client = createFreeKioskClient({ fetchImpl });
  assert.deepEqual(await client.getStatus(target), { battery: { level: 42 } });
  assert.equal(requests[0].url, 'http://192.168.1.50:8080/api/status');
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].headers['X-Api-Key'], 'secret');
  assert.ok(!requests[0].url.includes('secret'));
});

test('commands are POSTed as JSON', async () => {
  const { fetchImpl, requests } = stubFetch(() => jsonResponse(200, { success: true, data: {} }));
  const client = createFreeKioskClient({ fetchImpl });
  await client.command(target, '/api/brightness', { value: 40 });
  await client.command(target, '/api/reload');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].body, '{"value":40}');
  assert.equal(requests[0].headers['Content-Type'], 'application/json');
  assert.equal(requests[1].body, '{}');
});

test('a refused key and a disabled remote control become readable errors', async () => {
  const client401 = createFreeKioskClient({
    fetchImpl: async () =>
      jsonResponse(401, { success: false, error: 'Invalid or missing API key' }),
  });
  await assert.rejects(client401.getStatus(target), { code: 'UNAUTHORIZED', status: 401 });

  const client403 = createFreeKioskClient({
    fetchImpl: async () =>
      jsonResponse(403, { success: false, error: 'Remote control is disabled' }),
  });
  await assert.rejects(client403.command(target, '/api/reload'), /Allow remote control/);
});

test('an unreachable tablet is reported as such', async () => {
  const client = createFreeKioskClient({
    fetchImpl: async () => {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    },
  });
  await assert.rejects(client.getStatus(target), { code: 'UNREACHABLE', message: 'EHOSTUNREACH' });
});

test('probe recognizes FreeKiosk with and without an API key, and nothing else', async () => {
  const replies = {
    'http://10.0.0.1:8080/': () =>
      jsonResponse(200, { success: true, data: { name: 'FreeKiosk REST API', version: '1.0' } }),
    'http://10.0.0.2:8080/': () =>
      jsonResponse(
        401,
        { success: false, error: 'Invalid or missing API key' },
        { 'WWW-Authenticate': 'Basic realm="FreeKiosk"' },
      ),
    'http://10.0.0.3:8080/': () => new Response('<html>router</html>', { status: 200 }),
    'http://10.0.0.4:8080/': () => jsonResponse(401, { error: 'nope' }),
  };
  const client = createFreeKioskClient({
    fetchImpl: async (url) => {
      const reply = replies[String(url)];
      if (!reply) {
        throw new TypeError('fetch failed');
      }
      return reply();
    },
  });
  assert.deepEqual(await client.probe({ host: '10.0.0.1', port: 8080 }), { authRequired: false });
  assert.deepEqual(await client.probe({ host: '10.0.0.2', port: 8080 }), { authRequired: true });
  assert.equal(await client.probe({ host: '10.0.0.3', port: 8080 }), null);
  assert.equal(await client.probe({ host: '10.0.0.4', port: 8080 }), null);
  assert.equal(await client.probe({ host: '10.0.0.5', port: 8080 }), null);
});

test('getPhoto asks for the camera and the quality, and resolves the JPEG bytes', async () => {
  const { fetchImpl, requests } = stubFetch(
    () => new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200 }),
  );
  const client = createFreeKioskClient({ fetchImpl });
  const jpeg = await client.getPhoto(target, { camera: 'front', quality: 30 });
  assert.deepEqual([...jpeg], [0xff, 0xd8, 0xff]);
  assert.equal(
    requests[0].url,
    'http://192.168.1.50:8080/api/camera/photo?camera=front&quality=30',
  );
});
