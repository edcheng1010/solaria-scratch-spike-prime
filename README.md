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
1. Open TurboWarp → Add Extension → "Custom Extension" → load from URL (GitHub Pages build of `extension.js`).
2. Click the **Connect to SPIKE Prime** block (the click is the required user gesture for Web Bluetooth).
3. Pick your hub from the browser pairing dialog. The hub program auto-uploads on first connect.

## Status
Phase 4a — see [`../solaria-lib-spike-prime/PHASE_4A_PLAN.md`](../solaria-lib-spike-prime/PHASE_4A_PLAN.md).
`extension.js` is a skeleton: block definitions + connect flow stubbed, pending the bridge port.
