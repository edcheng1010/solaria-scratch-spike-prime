# solaria-scratch-spike-prime

A **Scratch 3.0 extension** (TurboWarp/PenguinMod) that controls a LEGO® SPIKE™ Prime hub over Bluetooth — no Scratch Link, no install, works on physical hubs.

This extension is the **Scratch/TurboWarp client** in the [Solaria](https://github.com/edcheng1010/solaria-hub) open-source robotics ecosystem. It implements the [Solaria Standard Protocol (SSP)](https://github.com/edcheng1010/solaria-hub/blob/main/spec/SSP-v0.8.md), which means the robot capabilities available here — motor control, sensor reading, real-time feedback — are the same as those available in the App Inventor and other Solaria clients. Scratch code is event-driven and block-sequential, which is different from App Inventor's stateful component model; both are valid approaches to the same hardware capabilities.

> **Unofficial integration.** Independent open-source project, not affiliated with, endorsed by, or
> sponsored by the LEGO Group, the Scratch Foundation, or MIT. Trademarks belong to their respective
> owners; references are nominative.

## How it works

The extension bundles the `@solaria/spike-prime` Web Bluetooth client (`../solaria-lib-spike-prime/web`).
It runs as an **unsandboxed** TurboWarp extension (page script context) so it can call
`navigator.bluetooth` directly. Block surface mirrors the App Inventor extension's 8 components, using the
same LEGO-aligned block names.

## Requirements
- **Browser:** Chrome, Edge, or Opera (desktop or Android). Web Bluetooth is not in Safari/Firefox.
- **Editor:** [TurboWarp](https://turbowarp.org) or PenguinMod (custom extensions). Official scratch.mit.edu
  cannot load custom extensions (a Scratch-Link path is a later phase).
- **Hub:** LEGO SPIKE Prime with firmware 3.x.

## Load it
1. Download `extension.js` and load it via TurboWarp → Add Extension → Custom Extension → **File** tab → check **"Run without sandbox"**.
2. Click the **connect to SPIKE Prime** block (required user gesture for Web Bluetooth).
3. Pick your hub from the browser pairing dialog. The hub program auto-uploads on first connect (~5–10 s).

## Connecting (Web Bluetooth)

Web Bluetooth requires the user to select a device via the browser's built-in chooser — there is no
programmatic scan or device-list API. This means the App Inventor scanning blocks (`StartScanning`,
`HubCount`, `HubName`, `ConnectToHub(index)`, etc.) have no equivalent here: **the browser chooser
replaces them**. The service-UUID filter (`0000fd02-…`) ensures only SPIKE Prime hubs appear in the list.

### Connection blocks

| Block | Type | Description |
|---|---|---|
| `connect to SPIKE Prime` | command | Opens browser device chooser, connects, uploads hub program |
| `disconnect from hub` | command | Clean disconnect; hub BLE drops immediately |
| `connected?` | boolean | True once capability handshake completes (not just during connecting) |
| `connected hub name` | reporter | BLE device name of the connected hub |
| `hub device type` | reporter | Hardware type from capability (e.g. `spike-prime`) |
| `hub SSP version` | reporter | Protocol version from capability (e.g. `0.8`) |
| `hub available ports` | reporter | Comma-separated port IDs (e.g. `A,B,C,D,E,F,display,status,imu`) |
| `hub encodings` | reporter | Supported encodings (e.g. `json-utf8-newline`) |
| `when hub connected` | hat | Fires once capability handshake completes |
| `when hub disconnected` | hat | Fires on clean disconnect, heartbeat loss, or BLE drop |
| `last disconnect reason` | reporter | `user` / `heartbeat_lost` / `connection_lost` |
| `when error occurs` | hat | Fires on SSP errors (§7) or transport errors |
| `last error message` | reporter | Description of the last error |
| `last error code` | reporter | SSP error code (200–499); 0 for transport errors |
| `set hub name filter to [PREFIX]` | command | Optional name-prefix filter for the device chooser |
| `set debug logging [on\|off]` | command | Enables verbose `console.debug` output from the client |

### Unexpected disconnects
The extension detects physical drops (hub powered off, out of range) via the `gattserverdisconnected`
event — `when hub disconnected` fires immediately with reason `connection_lost`, rather than waiting up
to 10 s for the heartbeat timeout.

### Web Bluetooth limitations
The following App Inventor capabilities have no Scratch equivalent due to Web Bluetooth API restrictions:

| App Inventor block | Reason omitted |
|---|---|
| `StartScanning`, `HubCount`, `HubName`, `ConnectToHub(index)` | Web Bluetooth has no programmatic scan or device enumeration; the browser chooser replaces them |
| `GetRSSI` / `RSSIRead` | Web Bluetooth does not expose RSSI for a connected GATT device; the hub itself returns `None` for `connection_rssi` |

Battery level, temperature, and charging state are available via the System blocks (`get hub battery level`, `get hub temperature`, `get hub charging state`).

## Part of the Solaria Ecosystem

This repository is one client extension in the [Solaria](https://github.com/edcheng1010/solaria-hub) open-source robotics ecosystem. Solaria supports multiple programming environments and multiple hardware platforms through a shared communication protocol (SSP). Each environment has its own purpose-built extension — this one is for Scratch/TurboWarp.

| What is the same across Solaria clients | What is different |
|---|---|
| Robot capabilities: motor control, sensor reading, real-time feedback, AI integration | Block names, event patterns, and code structure (each platform feels native) |
| SSP wire protocol (the messages sent to the robot) | Connection model (App Inventor scans for devices; Scratch uses the browser's built-in chooser) |
| Supported hardware combinations | Platform-specific limitations (e.g., RSSI not available via Web Bluetooth) |

For the full picture — hardware roadmap, architecture, and how to contribute — see [solaria-hub](https://github.com/edcheng1010/solaria-hub).

## Status

✅ **Supported** — blocks implemented and hardware-tested on physical SPIKE Prime hubs. All 8 component classes (Connection, Motors, Movement, Light, Sensors, Sound, System, Music) are at parity with the App Inventor extension.

See the [Solaria Hub Roadmap](https://github.com/edcheng1010/solaria-hub/blob/main/ROADMAP.md) for the full ecosystem status and upcoming Gen 2 work (additional hardware support, Python client, Web client).
