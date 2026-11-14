// The dashboard widgets: contents rendered exactly as sent (validateWidgetContent),
// live tiles bound to published features, every button handled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { OVERVIEW_WIDGET, TABLET_WIDGET } from '../src/widgets.js';
import { createFakeClient, sampleStatus } from './helpers/fakeTablets.js';

async function setup(tablets = { '192.168.1.50:8080': { status: sampleStatus() } }) {
  const client = createFakeClient(tablets);
  const gladys = createFakeGladys({ config: { scan_range: '192.168.1.50-192.168.1.51' } });
  const service = registerHandlers(gladys, { client, refreshDelayMs: 0 });
  await gladys.connect();
  await gladys.fake.scanRequest();
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  return { gladys, client, service };
}

const request = (settings = {}) => ({ settings, language: 'fr', units: 'metric' });

async function content(gladys, key, settings) {
  const ack = await gladys.fake.widgetGet(key, request(settings));
  assert.equal(ack.success, true, JSON.stringify(ack));
  return ack.data.content ?? ack.data;
}

test('the tablet widget is valid, with live tiles bound to published features', async () => {
  const { gladys } = await setup();
  const [device] = gladys.fake.discoveredDevices;
  const widget = await content(gladys, TABLET_WIDGET, { device: device.external_id });
  assert.deepEqual(validateWidgetContent(widget), []);

  const featureIds = new Set(device.features.map((f) => f.external_id));
  const bound = widget.components.filter((c) => c.device_feature);
  assert.equal(bound.length, 5); // 3 tiles + screen and reload buttons
  for (const component of bound) {
    assert.ok(featureIds.has(component.device_feature), component.device_feature);
  }
  const status = widget.components.find((c) => c.type === 'status');
  assert.ok(status.items.some((i) => i.value === 'dashboard.local'));
  const screen = widget.components.find((c) => c.device_feature?.endsWith(':screen'));
  assert.equal(screen.value, 0, 'the screen is on: the button turns it off');
});

test('the screen button follows the command, and the widgets are nudged', async () => {
  const { gladys } = await setup();
  const [device] = gladys.fake.discoveredDevices;
  const screen = device.features.find((f) => f.external_id.endsWith(':screen'));
  const before = gladys.fake.widgetRefreshes.length;
  await gladys.fake.setValue(device, screen, 0);
  assert.ok(gladys.fake.widgetRefreshes.length > before);

  const widget = await content(gladys, TABLET_WIDGET, { device: device.external_id });
  const button = widget.components.find((c) => c.device_feature?.endsWith(':screen'));
  assert.equal(button.value, 1);
});

test('an unreachable tablet shows no buttons, and an unknown one asks for settings', async () => {
  const { gladys, client, service } = await setup();
  const [device] = gladys.fake.discoveredDevices;
  client.lan.get('192.168.1.50:8080').offline = true;
  await service.refresh(service.registry.list()[0]).catch(() => undefined);

  const widget = await content(gladys, TABLET_WIDGET, { device: device.external_id });
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components.filter((c) => c.type === 'button').length, 0);
  assert.ok(JSON.stringify(widget).includes('Injoignable'));

  const empty = await content(gladys, TABLET_WIDGET, {});
  assert.deepEqual(validateWidgetContent(empty), []);
  assert.equal(empty.components[0].type, 'text');
});

test('the tablet widget form buttons open a URL and make the tablet speak', async () => {
  const { gladys, client } = await setup();
  const [device] = gladys.fake.discoveredDevices;
  const widget = await content(gladys, TABLET_WIDGET, { device: device.external_id });
  const actions = widget.components.filter((c) => c.action).map((c) => c.action);
  assert.deepEqual(
    actions.map((a) => a.key),
    ['load_url', 'speak'],
  );

  const values = { load_url: { url: 'https://example.com' }, speak: { text: 'Bonjour' } };
  for (const action of actions) {
    const ack = await gladys.fake.widgetAction(TABLET_WIDGET, action.key, action.params, {
      settings: { device: device.external_id },
      values: values[action.key],
    });
    assert.equal(ack.success, true, JSON.stringify(ack));
  }
  assert.deepEqual(
    client.calls.filter((c) => c.type === 'command').map((c) => [c.path, c.body]),
    [
      ['/api/url', { url: 'https://example.com' }],
      ['/api/tts', { text: 'Bonjour' }],
    ],
  );

  // An older core relays the tap without the typed values: refused.
  const ack = await gladys.fake.widgetAction(TABLET_WIDGET, 'speak', actions[1].params, {
    settings: {},
  });
  assert.equal(ack.success, false);
});

test('the overview lists the tablets and scans on demand', async () => {
  const { gladys, client } = await setup();
  let widget = await content(gladys, OVERVIEW_WIDGET);
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.equal(widget.components.find((c) => c.type === 'value').value, '1/1');
  const status = widget.components.find((c) => c.type === 'status');
  assert.equal(status.items[0].label, 'FreeKiosk SM-T510');
  assert.deepEqual(status.items[0].value, { en: 'Online · 85 %', fr: 'En ligne · 85 %' });

  // A second tablet appears on the network: the button finds it.
  client.lan.set('192.168.1.51:8080', { status: sampleStatus() });
  const ack = await gladys.fake.widgetAction(OVERVIEW_WIDGET, 'scan', {}, { settings: {} });
  assert.equal(ack.success, true);
  widget = await content(gladys, OVERVIEW_WIDGET);
  assert.equal(widget.components.find((c) => c.type === 'value').value, '2/2');
});

test('the overview without tablets invites to scan', async () => {
  const gladys = createFakeGladys();
  registerHandlers(gladys, { client: createFakeClient(), refreshDelayMs: 0 });
  await gladys.connect();
  const widget = await content(gladys, OVERVIEW_WIDGET);
  assert.deepEqual(validateWidgetContent(widget), []);
  assert.deepEqual(
    widget.components.map((c) => c.type),
    ['text', 'button'],
  );
});
