# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Discovery of FreeKiosk tablets by scanning the configured addresses (CIDR
  blocks, ranges or single IPs), and the "Add a tablet by IP" action.
- Control of each tablet through the FreeKiosk REST API: screen, screensaver,
  brightness, auto brightness, volume, open a URL, text-to-speech, messages,
  reload, wake, clear cache, restart FreeKiosk, lock, reboot and beep.
- Battery, charging, battery temperature, ambient light and current page,
  refreshed at the configured interval and right after each command.
- Optional camera (front or back) serving a photo taken on demand.
- Reachability badge per tablet, and the "Tablet online / offline" scene
  trigger.
- Scene actions: open a URL, speak (with a language), show a message, play and
  stop a sound.
- Dashboard widgets: "FreeKiosk tablet" (live battery, brightness and volume,
  status, screen / reload / open a URL / speak buttons) and "FreeKiosk
  tablets" (every tablet with its connection and battery, scan button).
- Actions to set a tablet's own API key, change its address and identify it.
- A tablet found by the scan at a new address keeps its device.
- User documentation in French and English.

[Unreleased]: https://github.com/quentinlegay/gladys-freekiosk/commits/main
