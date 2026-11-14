import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTablets, TabletRegistry } from '../src/registry.js';
import { TABLETS_CONFIG_KEY } from '../src/constants.js';

test('the registry round-trips through the config, and ignores garbage', () => {
  const registry = new TabletRegistry();
  const { tablet, created } = registry.add({ host: '192.168.1.50', port: 8080, model: 'SM-T510' });
  assert.ok(created);
  assert.match(tablet.id, /^[0-9a-f]{12}$/);

  const restored = TabletRegistry.fromConfig(registry.toConfig());
  assert.deepEqual(restored.list(), registry.list());

  assert.deepEqual(parseTablets('not json'), []);
  assert.deepEqual(parseTablets('{"a":1}'), []);
  assert.deepEqual(parseTablets('[{"id":"x"},null]'), []);
  assert.deepEqual(TabletRegistry.fromConfig({ [TABLETS_CONFIG_KEY]: undefined }).list(), []);
});

test('the same address is never registered twice, whatever its spelling', () => {
  const registry = new TabletRegistry();
  const first = registry.add({ host: 'Tablet.LAN', port: 8080 }).tablet;
  const again = registry.add({ host: 'http://tablet.lan/', port: 8080, name: 'Hall' });
  assert.equal(again.created, false);
  assert.equal(again.tablet.id, first.id);
  assert.equal(again.tablet.name, 'Hall');
  assert.equal(registry.list().length, 1);
});

test('the id survives an address change', () => {
  const registry = new TabletRegistry();
  const { tablet } = registry.add({ host: '192.168.1.50', port: 8080 });
  registry.update(tablet.id, { host: '192.168.1.77', port: 8081 });
  assert.equal(registry.findByAddress('192.168.1.77', 8081).id, tablet.id);
  assert.equal(registry.findByAddress('192.168.1.50', 8080), undefined);
});

test('a moved tablet is followed only when exactly one offline candidate matches', () => {
  const registry = new TabletRegistry();
  const a = registry.add({ host: '10.0.0.1', port: 8080, model: 'M1', manufacturer: 'x' }).tablet;
  const b = registry.add({ host: '10.0.0.2', port: 8080, model: 'M1', manufacturer: 'x' }).tablet;
  registry.add({ host: '10.0.0.3', port: 8080, model: 'M2', manufacturer: 'x' });

  const onlyAOffline = (t) => t.id === a.id;
  assert.equal(registry.findMovedCandidate({ model: 'M1', manufacturer: 'x' }, onlyAOffline), a);

  const bothOffline = (t) => t.id === a.id || t.id === b.id;
  assert.equal(
    registry.findMovedCandidate({ model: 'M1', manufacturer: 'x' }, bothOffline),
    undefined,
  );
  assert.equal(registry.findMovedCandidate({}, onlyAOffline), undefined);
});
