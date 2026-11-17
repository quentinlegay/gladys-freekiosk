# gladys-freekiosk

External [Gladys Assistant](https://gladysassistant.com) integration that
**discovers [FreeKiosk](https://freekiosk.app) tablets** on the local network
and **controls them** through FreeKiosk's REST API. User documentation:
[`docs/fr.md`](./docs/fr.md) (français) · [`docs/en.md`](./docs/en.md) (English).

Built from the [official JavaScript template](https://github.com/GladysAssistant/integration-template-js)
on the [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency (HTTP calls use Node's global `fetch`). Inspired by
[gladys-fullykiosk](https://github.com/vincentBesseau/gladys-fullykiosk).

## What it does

| Feature                                                             | Notes                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Discovery: network scan                                             | Probes the configured CIDR / ranges on the REST port; recognizes FreeKiosk even behind an API key (`realm="FreeKiosk"`)                                            |
| Discovery: add by IP                                                | Manifest action, checks the tablet answers first                                                                                                                   |
| Screen, screensaver, auto brightness                                | Switches with feedback (`/api/screen/*`, `/api/screensaver/*`, `/api/autoBrightness/*`)                                                                            |
| Brightness, volume                                                  | 0-100 % (`/api/brightness`, `/api/volume`)                                                                                                                         |
| Open a URL, speak, show a message                                   | Writable text features (`/api/url`, `/api/tts`, `/api/toast`)                                                                                                      |
| Reload, wake, clear cache, restart app, lock, reboot, beep          | Push buttons                                                                                                                                                       |
| Battery, charging, battery temperature, ambient light, current page | Read from `/api/status`, polled                                                                                                                                    |
| Camera (opt-in)                                                     | On demand only (`onGetImage` → `/api/camera/photo`): recent photo reused (battery), one shared capture, remembered quality under 150 KB; `take_photo` scene action |
| Availability                                                        | Transport badge (local / unreachable, degraded when the key is refused) + `tablet_availability_changed` scene trigger                                              |
| Dashboard widgets (Gladys 5.1+)                                     | `tablet` (live tiles, status, screen / reload / URL / speak buttons) and `tablets_overview` (fleet status, scan button)                                            |
| Scene actions (Gladys 5.1+)                                         | `load_url`, `speak` (with language), `show_message`, `play_audio`, `stop_audio`, `take_photo`                                                                      |

## Architecture

```
index.js                 entry point: SDK instance, shutdown, connect
src/app.js               registers every SDK handler (testable wiring)
src/tabletService.js     the logic: discovery, poll, commands, camera, actions, scenes
src/freekioskClient.js   FreeKiosk REST client (X-Api-Key header, probe, photo)
src/network.js           scan range parsing (CIDR / ranges) + concurrent probing
src/registry.js          known tablets, stable generated ids, persisted in the config
src/devices.js           Gladys device / features / states, command mapping
src/scenes.js            manifest actions + scene actions registry
src/widgets.js           dashboard widgets (content + button actions)
src/config.js            defaults (mirror the manifest) + normalization
src/constants.js         endpoints, feature keys, timeouts
```

FreeKiosk's API exposes no hardware identifier, so each tablet gets an id
generated at discovery and stored in the config (off-schema key
`tablets_json`); the address can change without changing the external ids.

## Local development

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="freekiosk" \
LOG_LEVEL=debug \
npm start
```

```bash
npm test               # node --test, against the SDK's fake Gladys (no network)
npm run lint           # ESLint
npm run format:check   # Prettier
npx github:GladysAssistant/integration-store .   # store admission checks
```

## Publishing

1. Add the GitHub topic `gladys-assistant-integration` to the repository.
2. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
3. **Actions → Release → Run workflow** (`patch`, `minor` or `major`): bumps the
   versions, tags, builds the multi-arch image to
   `ghcr.io/quentinlegay/gladys-freekiosk` and publishes the GitHub Release.

## License

Apache-2.0
