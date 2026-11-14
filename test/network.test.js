import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScanRange, scanHosts } from '../src/network.js';

test('a /24 expands to its 254 usable hosts', () => {
  const hosts = parseScanRange('192.168.1.0/24');
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], '192.168.1.1');
  assert.equal(hosts.at(-1), '192.168.1.254');
});

test('ranges, short ranges and single addresses are accepted and deduplicated', () => {
  assert.deepEqual(parseScanRange('10.0.0.5-10.0.0.7, 10.0.0.9'), [
    '10.0.0.5',
    '10.0.0.6',
    '10.0.0.7',
    '10.0.0.9',
  ]);
  assert.deepEqual(parseScanRange('10.0.0.250-252 10.0.0.251'), [
    '10.0.0.250',
    '10.0.0.251',
    '10.0.0.252',
  ]);
  assert.deepEqual(parseScanRange('192.168.1.40/32'), ['192.168.1.40']);
});

test('an empty range means no scan', () => {
  assert.deepEqual(parseScanRange(''), []);
  assert.deepEqual(parseScanRange(undefined), []);
});

test('invalid or too large ranges are refused with a readable error', () => {
  assert.throws(() => parseScanRange('192.168.1.300'), /invalid address/);
  assert.throws(() => parseScanRange('10.0.0.0/16'), /too large/);
  assert.throws(() => parseScanRange('10.0.0.9-10.0.0.1'), /invalid address range/);
  assert.throws(() => parseScanRange('10.0.0.0/22, 10.0.4.0/24'), /more than 1024/);
  assert.throws(() => parseScanRange('tablet.local'), /invalid address/);
});

test('scanHosts keeps the hosts that answered, sorted, and survives failing probes', async () => {
  const answers = { '10.0.0.12': { authRequired: false }, '10.0.0.3': { authRequired: true } };
  const found = await scanHosts(
    parseScanRange('10.0.0.1-10.0.0.20'),
    async (host) => {
      if (host === '10.0.0.7') {
        throw new Error('boom');
      }
      return answers[host] ?? null;
    },
    { concurrency: 4 },
  );
  assert.deepEqual(found, [
    { host: '10.0.0.3', authRequired: true },
    { host: '10.0.0.12', authRequired: false },
  ]);
});
