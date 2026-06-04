# solaria-scratch-spike-prime

A **Scratch 3.0 extension** (TurboWarp/PenguinMod) that controls a LEGO® SPIKE™ Prime hub over
Bluetooth — no Scratch Link, no install. Part of the [Solaria](https://github.com/edcheng1010/solaria-hub)
platform.

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

## Status
Phase 4a — blocks implemented and hardware-tested (Connection class parity with App Inventor).
See [`../solaria-lib-spike-prime/PHASE_4A_PLAN.md`](../solaria-lib-spike-prime/PHASE_4A_PLAN.md).
