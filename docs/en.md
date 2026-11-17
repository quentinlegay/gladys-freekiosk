# FreeKiosk for Gladys Assistant

This integration discovers the Android tablets running
[FreeKiosk](https://freekiosk.app) (an open-source kiosk app) on your local
network, and controls them from Gladys through FreeKiosk's built-in REST API:
screen, screensaver, brightness, volume, displayed page, text-to-speech,
messages, restart... No account, no cloud: Gladys talks to the tablets
directly.

## 1. Prepare each tablet

1. Install FreeKiosk (2.0 or later recommended).
2. Open the settings: 5 taps on the secret button, then your PIN.
3. **Advanced** tab > **REST API**:
   - turn on **Enable REST API**;
   - turn on **Allow remote control** (otherwise the tablet refuses the
     commands with a 403 error);
   - note the **port** (8080 by default);
   - set an **API key** (recommended) and note it.
4. Give the tablet a **fixed IP address** (a DHCP reservation on your router).
   The integration follows a tablet whose address changes (see below), but a
   fixed address avoids any surprise.

> Some commands need more rights on the tablet: truly turning the screen off
> and locking it go through FreeKiosk's **Device Owner**, **Device Admin** or
> **accessibility service** modes; rebooting the tablet requires **Device
> Owner**. Without them, "Screen off" dims the brightness to 0. See the
> [FreeKiosk documentation](https://github.com/RushB-fr/freekiosk/blob/main/docs/rest-api.md).

## 2. Configure the integration

In Gladys, **Integrations** > **FreeKiosk** > **Configuration**:

| Field             | Purpose                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| API key           | The key set in FreeKiosk, shared by your tablets. Empty if they have none.                                                            |
| Addresses to scan | Where to look for tablets: `192.168.1.0/24`, `192.168.1.20-192.168.1.60`, `192.168.1.50`... comma-separated (1024 addresses at most). |
| REST API port     | Port scanned, and default port of the tablets added by IP (8080).                                                                     |
| Refresh interval  | How often the tablets' status is read, in seconds (15 minimum, 30 by default).                                                        |
| Tablet camera     | Adds a camera (front or back) to the tablets created afterwards. Disabled by default.                                                 |
| Photo reuse delay | A photo younger than this (60 s by default) is shown again instead of waking the camera. 0 = a new photo on every request.            |

## 3. Discover the tablets

Two ways, which can be combined:

- **Network scan**: fill in _Addresses to scan_, then click **Scan the
  network** (or open the **Discovery** tab of the integration). Every address
  is asked on the configured port; a FreeKiosk tablet is recognized even when
  it has an API key.
- **Add by IP**: the **Add a tablet by IP** action, with the address, the port
  if different, the key if it differs from the shared one, and an optional
  name. The action checks that the tablet answers before adding it.

The tablets found show up in the **Discovery** tab: create them to add them to
Gladys (you can rename them and pick their room).

> The integration container does not see the multicast traffic of the local
> network (and FreeKiosk does not announce itself over mDNS): that is why the
> scan needs the address range to probe.

## 4. What you can do

Each tablet becomes a device with:

| Feature                                                                                     | Type                     |
| ------------------------------------------------------------------------------------------- | ------------------------ |
| Screen on / off                                                                             | Switch                   |
| Screensaver on / off                                                                        | Switch                   |
| Brightness (0-100 %)                                                                        | Dimmer                   |
| Auto brightness                                                                             | Switch                   |
| Volume (0-100 %)                                                                            | Volume                   |
| Battery, charging, battery temperature, ambient light                                       | Sensors                  |
| Current page                                                                                | Text (read-only)         |
| Open a URL, Speak (text-to-speech), Show a message                                          | Text (writing = running) |
| Reload the page, Wake up, Clear the cache, Restart FreeKiosk, Lock, Reboot the tablet, Beep | Buttons                  |
| Camera (photo taken on demand), when enabled                                                | Camera                   |

The status is read at the chosen interval, and right after each command. An
unreachable tablet gets an "unreachable" badge; a tablet that refuses the API
key, an orange dot.

### Scenes

- **"Tablet online / offline" trigger**: when a tablet stops or starts
  answering (filter by tablet and by status; `status` variable).
- **Actions**: _Open a URL on a tablet_, _Speak on a tablet_ (with the
  language, e.g. `en-US`), _Show a message_, _Play a sound_ (audio file URL,
  volume, loop), _Stop the sound_ and _Take a photo with a tablet_ (a new
  photo, to send with the "Send a camera image" action that follows).
- The device features (screen, brightness...) can also be driven with the
  standard "Control a device" action.

### Dashboard widgets

- **FreeKiosk tablet**: pick a tablet in the widget settings. It shows its
  battery, brightness and volume live, its status (connection, screen,
  current page, power) and four buttons: screen on / off, reload the page,
  open a URL and make the tablet speak (a small form opens). The buttons are
  hidden while the tablet is unreachable.
- **FreeKiosk tablets**: all your tablets (10 at most) with their connection
  and battery, the number of tablets online, and a **Scan the network**
  button.

## 5. Actions of the Configuration page

| Action                    | Use                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Scan the network          | Refreshes the known tablets and looks for new ones.                                  |
| Add a tablet by IP        | Adds a tablet without a scan.                                                        |
| Set a tablet's API key    | For a tablet whose key differs from the shared one (empty = back to the shared key). |
| Change a tablet's address | The tablet got a new IP: the device, its history and its scenes are kept.            |
| Identify a tablet         | The tablet wakes up, beeps and shows "Gladys 👋".                                    |

## 6. Good to know

- **Tablet identifier.** FreeKiosk's API exposes no hardware identifier: the
  integration gives each tablet an identifier when it is first found and keeps
  it for good. When the scan finds a tablet at a new address while the old one
  no longer answers, it recognizes it (same model, only candidate) and updates
  its address. Otherwise, use **Change a tablet's address**.
- **Camera.** The option only applies to the tablets created after it is
  enabled (a device's features are set when it is created: delete and create
  the tablet again to add it). The photo is compressed to fit Gladys' 150 KB
  limit. It fails while FreeKiosk's motion detection uses the camera.
- **Camera and battery.** The integration never films and never takes photos
  on a timer: a photo is taken only when Gladys asks for one (dashboard camera
  widget, chat, the "Take a photo" scene action). A photo younger than the
  _Photo reuse delay_ is shown again without waking the camera, simultaneous
  requests share one capture, and the integration remembers the JPEG quality
  that fits the 150 KB limit so it takes one shot, not several. On the tablet
  side, FreeKiosk 2.1+ keeps a silent "Remote camera available" service while
  the REST API is on; the camera itself only powers up for a photo.
- **Deleting a tablet** in Gladys forgets it: a later scan finds it again as a
  new tablet.
- **Security.** FreeKiosk's REST API is plain HTTP: keep the tablets on a
  trusted network and set an API key. The key never shows in URLs nor in the
  integration logs.

## Troubleshooting

| Symptom                           | Lead                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| The scan finds nothing            | REST API enabled? Right port? Does the range hold the tablet's IP? Tablet on the same network? |
| "refused the API key"             | Check the key in FreeKiosk > Advanced > REST API, or use "Set a tablet's API key".             |
| "remote control is disabled"      | Turn on "Allow remote control" in FreeKiosk.                                                   |
| The screen does not really go off | Enable FreeKiosk's Device Owner, Device Admin or accessibility service.                        |
| "Reboot the tablet" fails         | Requires Device Owner mode.                                                                    |
