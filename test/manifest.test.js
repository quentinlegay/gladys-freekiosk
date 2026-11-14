// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but only these tests know which
// handlers the code registers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SCENE_TRIGGER_AVAILABILITY } from '../src/constants.js';
import { MANIFEST_ACTIONS, SCENE_ACTIONS } from '../src/scenes.js';
import { registerHandlers } from '../src/app.js';
import { createFakeClient } from './helpers/fakeTablets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action has a handler, and vice versa', () => {
  const declared = keysOf(manifest.actions);
  for (const key of declared) {
    assert.equal(typeof MANIFEST_ACTIONS[key], 'function', `action "${key}" has no handler`);
  }
  for (const key of Object.keys(MANIFEST_ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in actions`);
  }
});

test('every scene_actions key has a handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  for (const key of declared) {
    assert.equal(typeof SCENE_ACTIONS[key], 'function', `scene action "${key}" has no handler`);
  }
  for (const key of Object.keys(SCENE_ACTIONS)) {
    assert.ok(declared.includes(key), `handler "${key}" is not declared in scene_actions`);
  }
});

test('the handlers are registered on the SDK', async () => {
  const gladys = createFakeGladys();
  registerHandlers(gladys, { client: createFakeClient(), refreshDelayMs: 0 });
  await gladys.connect();
  for (const key of keysOf(manifest.actions)) {
    const ack = await gladys.fake.action(key, {});
    assert.ok(!/no handler/i.test(ack.error ?? ''), `action "${key}" is registered`);
  }
});

test('the fired scene trigger is declared, with the keys of its data', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers), [SCENE_TRIGGER_AVAILABILITY]);
  const [trigger] = manifest.scene_triggers;
  assert.deepEqual(keysOf(trigger.fields), ['device', 'status']);
  assert.deepEqual(keysOf(trigger.variables), ['status']);
});

test('scene triggers and actions require Gladys >= 5.1.0, categories >= 4.86.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      assert.equal(field.default, undefined);
      assert.equal(field.required, undefined);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//, 'section links must be https');
      }
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config "${field.key}" is missing from DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of "${field.key}"`);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('every text is multi-language, with English and French', () => {
  const texts = [manifest.description];
  for (const item of [
    ...allFields,
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
    ...(manifest.scene_triggers ?? []).flatMap((t) => t.variables ?? []),
  ]) {
    texts.push(item.label);
    for (const key of ['description', 'placeholder']) {
      if (item[key] !== undefined) {
        texts.push(item[key]);
      }
    }
    for (const option of item.options ?? []) {
      texts.push(option.label);
    }
  }
  for (const text of texts) {
    assert.equal(typeof text, 'object', `plain string text: ${JSON.stringify(text)}`);
    assert.ok(text.en && text.fr, `missing en/fr: ${JSON.stringify(text)}`);
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});
