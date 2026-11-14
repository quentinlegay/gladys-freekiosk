// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
//   - `tablet`: one tablet chosen in the widget settings — live tiles bound to
//     its features (battery, brightness, volume), a computed status list
//     (reachability, screen, current page, charging) and four buttons (screen,
//     reload, open a URL, speak).
//   - `tablets_overview`: every known tablet with its reachability and
//     battery, and a button to scan the network.
//
// The content is DECLARATIVE (the core renders it with its own theme): the
// live tiles follow the published states by themselves; the computed parts
// are cached by the core until `ttl_seconds`, or until app.js nudges the
// widgets (requestWidgetRefresh) when a tablet changes. Every content is
// checked with the SDK's validateWidgetContent in test/widgets.test.js.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { FEATURE } from './constants.js';
import { tabletIds, tabletName } from './devices.js';

const logger = createLogger({ name: 'widgets' });

export const TABLET_WIDGET = 'tablet';
export const OVERVIEW_WIDGET = 'tablets_overview';

// Keys of the `button` actions the contents declare (relayed to `action`).
export const WIDGET_ACTIONS = {
  LOAD_URL: 'load_url',
  SPEAK: 'speak',
  SCAN: 'scan',
};

const MAX_STATUS_VALUE = 40;
const MAX_STATUS_ITEMS = 10;

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// "https://dashboard.local/lovelace/0" -> "dashboard.local/lovelace/0"
function shortUrl(url) {
  return truncate(url.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, ''), MAX_STATUS_VALUE);
}

function reachability(service, tablet) {
  const availability = service.availabilityOf(tablet);
  if (!availability) {
    return { value: { en: 'Unknown', fr: 'Inconnu' }, color: WIDGET_COLORS.NEUTRAL };
  }
  if (!availability.online) {
    return { value: { en: 'Unreachable', fr: 'Injoignable' }, color: WIDGET_COLORS.DANGER };
  }
  if (availability.authFailed) {
    return {
      value: { en: 'API key refused', fr: "Clé d'API refusée" },
      color: WIDGET_COLORS.WARNING,
    };
  }
  return { value: { en: 'Online', fr: 'En ligne' }, color: WIDGET_COLORS.SUCCESS };
}

function screenStatus(status) {
  if (status?.screenOn === undefined) {
    return { value: { en: 'Unknown', fr: 'Inconnu' }, color: WIDGET_COLORS.NEUTRAL };
  }
  if (!status.screenOn) {
    return { value: { en: 'Off', fr: 'Éteint' }, color: WIDGET_COLORS.NEUTRAL };
  }
  if (status.screensaverActive) {
    return { value: { en: 'Screensaver', fr: 'Économiseur' }, color: WIDGET_COLORS.INFO };
  }
  return { value: { en: 'On', fr: 'Allumé' }, color: WIDGET_COLORS.SUCCESS };
}

function emptyContent(text) {
  return { ttl_seconds: 300, components: [{ type: 'text', text }] };
}

/** Content of the `tablet` widget. */
export function buildTabletContent(service, settings = {}) {
  const tablet = service.tabletFromExternalId(settings.device);
  if (!tablet) {
    return emptyContent({
      en: 'Pick a FreeKiosk tablet in the widget settings.',
      fr: 'Choisissez une tablette FreeKiosk dans les réglages du widget.',
    });
  }
  const ids = tabletIds(service.gladys, tablet);
  const status = service.statusOf(tablet);
  const online = service.availabilityOf(tablet)?.online === true;

  const items = [
    {
      label: { en: 'Connection', fr: 'Connexion' },
      icon: 'wifi',
      ...reachability(service, tablet),
    },
    { label: { en: 'Screen', fr: 'Écran' }, icon: 'monitor', ...screenStatus(status) },
  ];
  if (status?.currentUrl) {
    items.push({
      label: { en: 'Page', fr: 'Page' },
      icon: 'globe',
      value: shortUrl(status.currentUrl),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (status?.charging !== undefined) {
    items.push({
      label: { en: 'Power', fr: 'Alimentation' },
      icon: status.charging ? 'battery-charging' : 'battery',
      value: status.charging
        ? { en: 'Charging', fr: 'En charge' }
        : { en: 'Battery', fr: 'Batterie' },
      color: status.charging ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }

  const screenOn = status?.screenOn !== false;
  const components = [
    {
      type: 'value',
      label: { en: 'Battery', fr: 'Batterie' },
      icon: 'battery',
      device_feature: ids.feature(FEATURE.BATTERY),
    },
    {
      type: 'value',
      label: { en: 'Brightness', fr: 'Luminosité' },
      icon: 'sun',
      device_feature: ids.feature(FEATURE.BRIGHTNESS),
    },
    {
      type: 'value',
      label: { en: 'Volume', fr: 'Volume' },
      icon: 'volume-2',
      device_feature: ids.feature(FEATURE.VOLUME),
    },
    { type: 'status', items },
  ];

  // An unreachable tablet cannot take a command: no buttons that would fail.
  if (online) {
    components.push(
      {
        type: 'button',
        label: screenOn
          ? { en: 'Screen off', fr: "Éteindre l'écran" }
          : { en: 'Screen on', fr: "Allumer l'écran" },
        icon: 'power',
        style: 'primary',
        device_feature: ids.feature(FEATURE.SCREEN),
        value: screenOn ? 0 : 1,
      },
      {
        type: 'button',
        label: { en: 'Reload', fr: 'Recharger' },
        icon: 'refresh-cw',
        style: 'secondary',
        device_feature: ids.feature(FEATURE.RELOAD),
        value: 1,
      },
      {
        type: 'button',
        label: { en: 'Open a URL', fr: 'Ouvrir une URL' },
        icon: 'external-link',
        style: 'secondary',
        action: {
          key: WIDGET_ACTIONS.LOAD_URL,
          params: { device: ids.device },
          fields: [
            {
              key: 'url',
              type: 'string',
              required: true,
              label: { en: 'URL', fr: 'URL' },
              default: status?.currentUrl ?? '',
            },
          ],
        },
      },
      {
        type: 'button',
        label: { en: 'Speak', fr: 'Faire parler' },
        icon: 'message-circle',
        style: 'secondary',
        action: {
          key: WIDGET_ACTIONS.SPEAK,
          params: { device: ids.device },
          fields: [
            { key: 'text', type: 'string', required: true, label: { en: 'Text', fr: 'Texte' } },
          ],
        },
      },
    );
  }
  // The computed rows move with the tablet: re-pulled every minute at most,
  // and nudged on reachability and screen changes.
  return { ttl_seconds: 60, components };
}

/** Content of the `tablets_overview` widget. */
export function buildOverviewContent(service) {
  const tablets = service.registry.list();
  const scanButton = {
    type: 'button',
    label: { en: 'Scan the network', fr: 'Scanner le réseau' },
    icon: 'search',
    style: 'secondary',
    action: { key: WIDGET_ACTIONS.SCAN },
  };
  if (tablets.length === 0) {
    return {
      ttl_seconds: 300,
      components: [
        {
          type: 'text',
          text: {
            en: 'No FreeKiosk tablet yet: scan the network or add one by IP in the integration configuration.',
            fr: "Aucune tablette FreeKiosk pour l'instant : scannez le réseau ou ajoutez-en une par IP dans la configuration de l'intégration.",
          },
        },
        scanButton,
      ],
    };
  }

  const online = tablets.filter((t) => service.availabilityOf(t)?.online).length;
  const items = tablets.slice(0, MAX_STATUS_ITEMS).map((tablet) => {
    const { value, color } = reachability(service, tablet);
    const battery = service.statusOf(tablet)?.batteryLevel;
    const isOnline = service.availabilityOf(tablet)?.online === true;
    return {
      label: truncate(tabletName(tablet), MAX_STATUS_VALUE),
      icon: 'tablet',
      // "En ligne · 85 %": the battery only means something while it answers.
      value:
        isOnline && battery !== undefined
          ? { en: `${value.en} · ${battery} %`, fr: `${value.fr} · ${battery} %` }
          : value,
      color,
    };
  });

  return {
    ttl_seconds: 60,
    components: [
      {
        type: 'value',
        label: { en: 'Online', fr: 'En ligne' },
        icon: 'wifi',
        value: `${online}/${tablets.length}`,
        color: online === tablets.length ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
      },
      { type: 'status', items },
      scanButton,
    ],
  };
}

export const WIDGETS = {
  [TABLET_WIDGET]: {
    get: (service, { settings }) => buildTabletContent(service, settings),

    async action(service, { actionKey, params, values }) {
      logger.info(`onWidgetAction <- ${TABLET_WIDGET}.${actionKey}`);
      // An older core drops the button `fields` and relays the tap without
      // `values`: refuse rather than send an empty command.
      if (actionKey === WIDGET_ACTIONS.LOAD_URL) {
        if (!values?.url) {
          throw new Error('Missing URL: update Gladys to use this button');
        }
        await service.sceneLoadUrl({ device: params.device, url: values.url });
        return { en: 'Page opened on the tablet.', fr: 'Page ouverte sur la tablette.' };
      }
      if (actionKey === WIDGET_ACTIONS.SPEAK) {
        if (!values?.text) {
          throw new Error('Missing text: update Gladys to use this button');
        }
        await service.sceneSpeak({ device: params.device, text: values.text });
        return { en: 'The tablet is speaking.', fr: 'La tablette parle.' };
      }
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },

  [OVERVIEW_WIDGET]: {
    get: (service) => buildOverviewContent(service),

    async action(service, { actionKey }) {
      logger.info(`onWidgetAction <- ${OVERVIEW_WIDGET}.${actionKey}`);
      if (actionKey === WIDGET_ACTIONS.SCAN) {
        return service.actionScan();
      }
      throw new Error(`Unknown widget action: ${actionKey}`);
    },
  },
};

/**
 * Ask the core to re-pull every widget now (fire-and-forget, rate-limited
 * core-side to 1 per 10 s per widget, dropped while disconnected).
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
