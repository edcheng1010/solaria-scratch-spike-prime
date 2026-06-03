// solaria-scratch-spike-prime — TurboWarp/PenguinMod unsandboxed extension.
// Block surface mirrors the 8-component App Inventor extension (SSP v0.8).
// Command/param names are taken verbatim from the App Inventor components, which are the
// hardware-proven reference client (see solaria-hub/spec/SSP-v0.8.md).
// Must run unsandboxed: requires navigator.bluetooth (Web Bluetooth API).
import { SpikeClient, WebBleTransport } from "@solaria/spike-prime";
import HUB_PROGRAM from "../../solaria-lib-spike-prime/hub/hub_controller.py";

(function (Scratch) {
  "use strict";
  if (!Scratch.extensions.unsandboxed) {
    throw new Error("solaria-spike-prime must run unsandboxed (needs Web Bluetooth).");
  }

  const { BlockType, ArgumentType, Cast } = Scratch;

  // ─── Menu constants (match the App Inventor enums) ─────────────────────────
  const PORTS       = ["A", "B", "C", "D", "E", "F"];
  const DIRECTIONS  = ["clockwise", "counterclockwise"];
  const STOP_ACTS   = ["brake", "coast", "hold"];
  const COLORS      = ["red", "orange", "yellow", "green", "cyan", "azure", "blue",
                        "violet", "magenta", "white", "black"];
  const HUB_FACES   = ["Top", "Bottom", "Front", "Back", "Left side", "Right side"];
  const HUB_BUTTONS = ["Left", "Right"];
  const TILT_DIRS   = ["forward", "backward", "left", "right", "any"];
  const TILT_AXES   = ["pitch", "roll", "yaw"];
  const BTN_COLORS  = ["azure", "black", "blue", "cyan", "green", "magenta", "orange",
                        "red", "violet", "white", "yellow", "off"];
  const IMAGES      = ["HAPPY", "SAD", "SMILE", "HEART", "HEARTSMALL", "CONFUSED", "ANGRY",
                        "ASLEEP", "SURPRISED", "YES", "NO",
                        "ARROWNORTH", "ARROWEAST", "ARROWSOUTH", "ARROWWEST"];
  const NOTES       = [
    "C3","Csharp3","D3","Dsharp3","E3","F3","Fsharp3","G3","Gsharp3","A3","Asharp3","B3",
    "C4","Csharp4","D4","Dsharp4","E4","F4","Fsharp4","G4","Gsharp4","A4","Asharp4","B4",
    "C5","Csharp5","D5","Dsharp5","E5","F5","Fsharp5","G5","Gsharp5","A5","Asharp5","B5",
    "C6","Csharp6","D6","Dsharp6","E6","F6","Fsharp6","G6","Gsharp6","A6","Asharp6","B6",
    "C7",
  ];

  // Note name → MIDI number (C4 = MIDI 60); freq = 440 * 2^((midi-69)/12)
  const NOTE_NAMES = ["C","Csharp","D","Dsharp","E","F","Fsharp","G","Gsharp","A","Asharp","B"];
  const NOTE_MIDI = {};
  NOTES.forEach((n) => {
    const octave = parseInt(n.slice(-1), 10);
    const name   = n.slice(0, -1);
    NOTE_MIDI[n] = (octave + 1) * 12 + NOTE_NAMES.indexOf(name);
  });

  const menuOf = (arr) => arr.map((v) => ({ text: v, value: v }));
  const signed = (dir, mag) =>
    dir === "counterclockwise" ? -Math.abs(Cast.toNumber(mag)) : Math.abs(Cast.toNumber(mag));

  // ─── State ──────────────────────────────────────────────────────────────────
  let client = null;
  let leftPort = "E", rightPort = "F";   // movement pair (set by setMovementPair)
  let tempo = 120;                        // music tempo (client-side)

  // System metric cache — populated by subscriptions started at connect time.
  const sysCache = { battery: 0, temperature: 0, charging: false };

  // Tracks which button subscriptions are active so the hat can auto-subscribe.
  const btnSubscribed = { Left: false, Right: false };

  // Edge-trigger flags for hat blocks (set by the subscription event handler)
  const flags = {
    hubConnected: false,
    hubDisconnected: false,
    colorChanged:    {},   // port → bool
    distanceChanged: {},   // port → bool
    buttonPressed:   { Left: false, Right: false },
    buttonReleased:  { Left: false, Right: false },
  };
  const buttonState = { Left: false, Right: false };

  // ─── Connection event routing ────────────────────────────────────────────────
  function onClientEvent(ev) {
    if (ev.type === "connected") {
      flags.hubConnected = true;
      // Subscribe to system metrics at connect time so reporters return live values
      // without a round-trip. Use a 5-second interval (battery/temp don't change fast).
      send({ cmd: "system.subscribe", metric: "battery",     interval: 5000 });
      send({ cmd: "system.subscribe", metric: "temperature", interval: 5000 });
      send({ cmd: "system.subscribe", metric: "charging",    interval: 5000 });
    } else if (ev.type === "disconnected") {
      flags.hubDisconnected = true;
      btnSubscribed.Left  = false;
      btnSubscribed.Right = false;
      client = null;
    } else if (ev.type === "ssp") {
      routeSSP(ev.event);
    }
  }

  // Routes subscription-driven events into caches and edge-trigger flags.
  function routeSSP(ev) {
    if (!ev) return;
    if (ev.event === "sensor") {
      if (ev.type === "color")    flags.colorChanged[ev.port] = true;
      if (ev.type === "distance") flags.distanceChanged[ev.port] = true;
    } else if (ev.event === "system") {
      const m = ev.metric;
      // System metric cache (populated by subscriptions started on connect).
      if (m === "battery")     { sysCache.battery     = ev.value ?? 0;     return; }
      if (m === "temperature") { sysCache.temperature = ev.value ?? 0;     return; }
      if (m === "charging")    { sysCache.charging    = !!ev.value;        return; }
      // Button subscriptions emit metric "button.left"/"button.right".
      if (m === "button.left" || m === "button.right") {
        const btn = m === "button.left" ? "Left" : "Right";
        const pressed = ev.value === "pressed";
        const was = buttonState[btn];
        buttonState[btn] = pressed;
        if (pressed && !was) flags.buttonPressed[btn]  = true;
        if (!pressed && was) flags.buttonReleased[btn] = true;
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function send(cmd) {
    if (!client) return Promise.resolve();
    return client.sendSSP(cmd).catch(() => {});
  }

  // Send a command and resolve with the first matching SSP event (one-shot read).
  // Returns null on timeout / not-connected.
  function requestEvent(cmd, matchFn, timeoutMs = 3000) {
    return new Promise((resolve) => {
      if (!client) return resolve(null);
      let done = false;
      const finish = (v) => { if (!done) { done = true; client.off(handler); resolve(v); } };
      const handler = (e) => {
        if (e.type === "ssp" && matchFn(e.event)) finish(e.event);
        else if (e.type === "disconnected") finish(null);
      };
      client.on(handler);
      client.sendSSP(cmd).catch(() => finish(null));
      setTimeout(() => finish(null), timeoutMs);
    });
  }

  const sensorMatch = (port, type) => (ev) =>
    ev.event === "sensor" && ev.port === port && ev.type === type;
  const systemMatch = (metric) => (ev) => ev.event === "system" && ev.metric === metric;

  async function readSensor(port, type, def) {
    const ev = await requestEvent({ cmd: "sensor.read", port, type }, sensorMatch(port, type));
    return ev ? ev.value : def;
  }
  // Client-side wait used by music blocks so notes/rests sequence visually in Scratch.
  const waitMs = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

  // ─── Extension ────────────────────────────────────────────────────────────────
  class SolariaSpikePrime {
    getInfo() {
      return {
        id: "solariaspikeprime",
        name: "SPIKE Prime",
        color1: "#0090C8",
        color2: "#0082B5",
        blocks: [
          { blockType: BlockType.LABEL, text: "Connection" },
          { opcode: "connect", blockType: BlockType.COMMAND, text: "connect to SPIKE Prime" },
          { opcode: "disconnect", blockType: BlockType.COMMAND, text: "disconnect from hub" },
          { opcode: "isConnected", blockType: BlockType.BOOLEAN, text: "connected?" },
          { opcode: "whenHubConnected", blockType: BlockType.HAT, isEdgeActivated: false, text: "when hub connected" },
          { opcode: "whenHubDisconnected", blockType: BlockType.HAT, isEdgeActivated: false, text: "when hub disconnected" },

          "---",
          { blockType: BlockType.LABEL, text: "Motors" },
          { opcode: "startMotor", blockType: BlockType.COMMAND,
            text: "start motor [PORT] [DIRECTION] at [SPEED] %",
            arguments: {
              PORT:      { type: ArgumentType.STRING, menu: "ports",      defaultValue: "A" },
              DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "clockwise" },
              SPEED:     { type: ArgumentType.NUMBER, defaultValue: 75 } } },
          { opcode: "stopMotor", blockType: BlockType.COMMAND,
            text: "stop motor [PORT] [ACTION]",
            arguments: {
              PORT:   { type: ArgumentType.STRING, menu: "ports",       defaultValue: "A" },
              ACTION: { type: ArgumentType.STRING, menu: "stopActions", defaultValue: "brake" } } },
          { opcode: "runMotorForSeconds", blockType: BlockType.COMMAND,
            text: "run motor [PORT] [DIRECTION] at [SPEED] % for [SECS] seconds",
            arguments: {
              PORT:      { type: ArgumentType.STRING, menu: "ports",      defaultValue: "A" },
              DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "clockwise" },
              SPEED:     { type: ArgumentType.NUMBER, defaultValue: 75 },
              SECS:      { type: ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: "runMotorForDegrees", blockType: BlockType.COMMAND,
            text: "run motor [PORT] [DIRECTION] at [SPEED] % for [DEG] degrees",
            arguments: {
              PORT:      { type: ArgumentType.STRING, menu: "ports",      defaultValue: "A" },
              DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "clockwise" },
              SPEED:     { type: ArgumentType.NUMBER, defaultValue: 75 },
              DEG:       { type: ArgumentType.NUMBER, defaultValue: 360 } } },
          { opcode: "goToMotorPosition", blockType: BlockType.COMMAND,
            text: "go to motor [PORT] absolute position [POS]° at [SPEED] %",
            arguments: {
              PORT:  { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
              POS:   { type: ArgumentType.NUMBER, defaultValue: 0 },
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 75 } } },
          { opcode: "setMotorAcceleration", blockType: BlockType.COMMAND,
            text: "set motor [PORT] acceleration to [RATE] ms",
            arguments: {
              PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
              RATE: { type: ArgumentType.NUMBER, defaultValue: 500 } } },
          { opcode: "resetMotorPosition", blockType: BlockType.COMMAND,
            text: "reset motor [PORT] position",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } } },
          { opcode: "getMotorPosition", blockType: BlockType.REPORTER,
            text: "motor [PORT] position (degrees)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } } },
          { opcode: "getMotorSpeed", blockType: BlockType.REPORTER,
            text: "motor [PORT] speed (%)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } } },

          "---",
          { blockType: BlockType.LABEL, text: "Movement" },
          { opcode: "setMovementPair", blockType: BlockType.COMMAND,
            text: "set movement motors [LEFT] (left) [RIGHT] (right)",
            arguments: {
              LEFT:  { type: ArgumentType.STRING, menu: "ports", defaultValue: "E" },
              RIGHT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "F" } } },
          { opcode: "startMoving", blockType: BlockType.COMMAND,
            text: "start moving at [SPEED] %",
            arguments: { SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 } } },
          { opcode: "startMovingWithSteering", blockType: BlockType.COMMAND,
            text: "start moving at [SPEED] % with steering [STEER]",
            arguments: {
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 },
              STEER: { type: ArgumentType.NUMBER, defaultValue: 0 } } },
          { opcode: "stopMoving", blockType: BlockType.COMMAND, text: "stop moving" },
          { opcode: "moveForDegrees", blockType: BlockType.COMMAND,
            text: "move [DEG] degrees at [SPEED] %",
            arguments: {
              DEG:   { type: ArgumentType.NUMBER, defaultValue: 360 },
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 } } },
          { opcode: "moveForRotations", blockType: BlockType.COMMAND,
            text: "move [ROT] rotations at [SPEED] %",
            arguments: {
              ROT:   { type: ArgumentType.NUMBER, defaultValue: 1 },
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 } } },
          { opcode: "setMovementAcceleration", blockType: BlockType.COMMAND,
            text: "set movement acceleration to [RATE] ms",
            arguments: { RATE: { type: ArgumentType.NUMBER, defaultValue: 500 } } },

          "---",
          { blockType: BlockType.LABEL, text: "Light" },
          { opcode: "showImage", blockType: BlockType.COMMAND,
            text: "show image [IMAGE]",
            arguments: { IMAGE: { type: ArgumentType.STRING, menu: "images", defaultValue: "HAPPY" } } },
          { opcode: "clearLightMatrix", blockType: BlockType.COMMAND, text: "turn off light matrix" },
          { opcode: "writeOnLightMatrix", blockType: BlockType.COMMAND,
            text: "write [TEXT] on light matrix",
            arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: "Hi" } } },
          { opcode: "setPixel", blockType: BlockType.COMMAND,
            text: "set pixel col [X] row [Y] to brightness [B] %",
            arguments: {
              X: { type: ArgumentType.NUMBER, defaultValue: 3 },
              Y: { type: ArgumentType.NUMBER, defaultValue: 3 },
              B: { type: ArgumentType.NUMBER, defaultValue: 100 } } },
          { opcode: "setLightMatrixBrightness", blockType: BlockType.COMMAND,
            text: "set light matrix brightness to [LEVEL] %",
            arguments: { LEVEL: { type: ArgumentType.NUMBER, defaultValue: 100 } } },
          { opcode: "setCenterButtonLight", blockType: BlockType.COMMAND,
            text: "set center button light to [COLOR]",
            arguments: { COLOR: { type: ArgumentType.STRING, menu: "btnColors", defaultValue: "azure" } } },
          { opcode: "lightUpDistanceSensor", blockType: BlockType.COMMAND,
            text: "light distance sensor [PORT] TL [TL] TR [TR] BL [BL] BR [BR]",
            arguments: {
              PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" },
              TL: { type: ArgumentType.NUMBER, defaultValue: 100 },
              TR: { type: ArgumentType.NUMBER, defaultValue: 100 },
              BL: { type: ArgumentType.NUMBER, defaultValue: 100 },
              BR: { type: ArgumentType.NUMBER, defaultValue: 100 } } },

          "---",
          { blockType: BlockType.LABEL, text: "Sensors" },
          { opcode: "getColor", blockType: BlockType.REPORTER,
            text: "color at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } } },
          { opcode: "getDistance", blockType: BlockType.REPORTER,
            text: "distance at [PORT] (mm)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } } },
          { opcode: "getForce", blockType: BlockType.REPORTER,
            text: "force at [PORT] (N)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "D" } } },
          { opcode: "getReflectedLight", blockType: BlockType.REPORTER,
            text: "reflected light at [PORT] (%)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } } },
          { opcode: "isColor", blockType: BlockType.BOOLEAN,
            text: "color at [PORT] is [COLOR]?",
            arguments: {
              PORT:  { type: ArgumentType.STRING, menu: "ports",  defaultValue: "C" },
              COLOR: { type: ArgumentType.STRING, menu: "colors", defaultValue: "red" } } },
          { opcode: "isCloserThan", blockType: BlockType.BOOLEAN,
            text: "distance at [PORT] closer than [MM] mm?",
            arguments: {
              PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" },
              MM:   { type: ArgumentType.NUMBER, defaultValue: 100 } } },
          { opcode: "isReflectedLightAbove", blockType: BlockType.BOOLEAN,
            text: "reflected light at [PORT] above [PCT] %?",
            arguments: {
              PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" },
              PCT:  { type: ArgumentType.NUMBER, defaultValue: 50 } } },
          { opcode: "isForceSensorPressed", blockType: BlockType.BOOLEAN,
            text: "force sensor at [PORT] pressed?",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "D" } } },
          { opcode: "getTiltAngle", blockType: BlockType.REPORTER,
            text: "hub tilt angle [AXIS]",
            arguments: { AXIS: { type: ArgumentType.STRING, menu: "tiltAxes", defaultValue: "pitch" } } },
          { opcode: "isTilted", blockType: BlockType.BOOLEAN,
            text: "hub tilted [DIRECTION]?",
            arguments: { DIRECTION: { type: ArgumentType.STRING, menu: "tiltDirs", defaultValue: "forward" } } },
          { opcode: "isHubOrientation", blockType: BlockType.BOOLEAN,
            text: "hub face [FACE] up?",
            arguments: { FACE: { type: ArgumentType.STRING, menu: "hubFaces", defaultValue: "Top" } } },
          { opcode: "isShaking", blockType: BlockType.BOOLEAN, text: "hub shaking?" },
          { opcode: "isHubButtonPressed", blockType: BlockType.BOOLEAN,
            text: "hub [BUTTON] button pressed?",
            arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } } },
          { opcode: "getHubTimer", blockType: BlockType.REPORTER, text: "hub timer (seconds)" },
          { opcode: "resetHubTimer", blockType: BlockType.COMMAND, text: "reset hub timer" },
          { opcode: "whenColorRead", blockType: BlockType.HAT, isEdgeActivated: false,
            text: "when color changes at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } } },
          { opcode: "whenDistanceRead", blockType: BlockType.HAT, isEdgeActivated: false,
            text: "when distance changes at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } } },
          { opcode: "whenHubButtonPressed", blockType: BlockType.HAT, isEdgeActivated: false,
            text: "when hub [BUTTON] button pressed",
            arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } } },
          { opcode: "whenHubButtonReleased", blockType: BlockType.HAT, isEdgeActivated: false,
            text: "when hub [BUTTON] button released",
            arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } } },
          { opcode: "subscribeToColor", blockType: BlockType.COMMAND,
            text: "subscribe to color sensor at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } } },
          { opcode: "subscribeToDistance", blockType: BlockType.COMMAND,
            text: "subscribe to distance sensor at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } } },
          { opcode: "subscribeToHubButton", blockType: BlockType.COMMAND,
            text: "subscribe to hub [BUTTON] button",
            arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } } },

          "---",
          { blockType: BlockType.LABEL, text: "Sound" },
          { opcode: "beep", blockType: BlockType.COMMAND,
            text: "beep at [FREQ] Hz for [DUR] ms",
            arguments: {
              FREQ: { type: ArgumentType.NUMBER, defaultValue: 440 },
              DUR:  { type: ArgumentType.NUMBER, defaultValue: 500 } } },
          { opcode: "startBeep", blockType: BlockType.COMMAND,
            text: "start beeping at [FREQ] Hz",
            arguments: { FREQ: { type: ArgumentType.NUMBER, defaultValue: 440 } } },
          { opcode: "stopAllSounds", blockType: BlockType.COMMAND, text: "stop all sounds" },
          { opcode: "setVolume", blockType: BlockType.COMMAND,
            text: "set hub volume to [LEVEL] %",
            arguments: { LEVEL: { type: ArgumentType.NUMBER, defaultValue: 75 } } },
          { opcode: "getVolume", blockType: BlockType.REPORTER, text: "hub volume (%)" },

          "---",
          { blockType: BlockType.LABEL, text: "System" },
          { opcode: "getBatteryLevel", blockType: BlockType.REPORTER, text: "hub battery (%)" },
          { opcode: "getTemperature", blockType: BlockType.REPORTER, text: "hub temperature (°C)" },
          { opcode: "isCharging", blockType: BlockType.BOOLEAN, text: "hub charging?" },

          "---",
          { blockType: BlockType.LABEL, text: "Music" },
          { opcode: "playNoteForBeats", blockType: BlockType.COMMAND,
            text: "play note [NOTE] for [BEATS] beats",
            arguments: {
              NOTE:  { type: ArgumentType.STRING, menu: "notes", defaultValue: "A4" },
              BEATS: { type: ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: "restForBeats", blockType: BlockType.COMMAND,
            text: "rest for [BEATS] beats",
            arguments: { BEATS: { type: ArgumentType.NUMBER, defaultValue: 1 } } },
          { opcode: "setTempo", blockType: BlockType.COMMAND,
            text: "set tempo to [BPM] BPM",
            arguments: { BPM: { type: ArgumentType.NUMBER, defaultValue: 120 } } },
          { opcode: "changeTempo", blockType: BlockType.COMMAND,
            text: "change tempo by [DELTA] BPM",
            arguments: { DELTA: { type: ArgumentType.NUMBER, defaultValue: 10 } } },
          { opcode: "getTempo", blockType: BlockType.REPORTER, text: "tempo (BPM)" },
        ],

        menus: {
          ports:       { acceptReporters: true, items: menuOf(PORTS) },
          directions:  { acceptReporters: true, items: menuOf(DIRECTIONS) },
          stopActions: { acceptReporters: true, items: menuOf(STOP_ACTS) },
          colors:      { acceptReporters: true, items: menuOf(COLORS) },
          hubFaces:    { acceptReporters: true, items: menuOf(HUB_FACES) },
          hubButtons:  { acceptReporters: true, items: menuOf(HUB_BUTTONS) },
          tiltDirs:    { acceptReporters: true, items: menuOf(TILT_DIRS) },
          tiltAxes:    { acceptReporters: true, items: menuOf(TILT_AXES) },
          btnColors:   { acceptReporters: true, items: menuOf(BTN_COLORS) },
          images:      { acceptReporters: true, items: menuOf(IMAGES) },
          notes:       { acceptReporters: true, items: menuOf(NOTES) },
        },
      };
    }

    // ── Connectivity ────────────────────────────────────────────────────────────
    async connect() {
      try {
        client = new SpikeClient(new WebBleTransport(), HUB_PROGRAM);
        client.on(onClientEvent);
        await client.connect();
      } catch (e) {
        client = null;
        console.error("[SolariaSpikePrime] connect error:", e);
      }
    }
    async disconnect() { if (client) await client.disconnect().catch(() => {}); }
    isConnected() { return !!client; }
    whenHubConnected()    { const v = flags.hubConnected;    flags.hubConnected    = false; return v; }
    whenHubDisconnected() { const v = flags.hubDisconnected; flags.hubDisconnected = false; return v; }

    // ── Motors ──────────────────────────────────────────────────────────────────
    startMotor({ PORT, DIRECTION, SPEED }) {
      return send({ cmd: "motor.run", port: PORT, speed: signed(DIRECTION, SPEED) });
    }
    stopMotor({ PORT, ACTION }) {
      return send({ cmd: "motor.stop", port: PORT, stop_action: ACTION });
    }
    runMotorForSeconds({ PORT, DIRECTION, SPEED, SECS }) {
      return send({ cmd: "motor.run", port: PORT, speed: signed(DIRECTION, SPEED),
        duration: Math.round(Cast.toNumber(SECS) * 1000), duration_unit: "ms" });
    }
    runMotorForDegrees({ PORT, DIRECTION, SPEED, DEG }) {
      return send({ cmd: "motor.run", port: PORT, speed: signed(DIRECTION, SPEED),
        duration: Cast.toNumber(DEG), duration_unit: "degrees" });
    }
    goToMotorPosition({ PORT, POS, SPEED }) {
      const pos = Math.max(0, Math.min(359, Cast.toNumber(POS)));
      return send({ cmd: "motor.goto", port: PORT, position: pos,
        speed: Math.abs(Cast.toNumber(SPEED)), mode: "absolute" });
    }
    setMotorAcceleration({ PORT, RATE }) {
      return send({ cmd: "motor.set_acceleration", port: PORT,
        rate: Math.max(0, Math.min(10000, Cast.toNumber(RATE))) });
    }
    resetMotorPosition({ PORT }) { return send({ cmd: "motor.reset", port: PORT }); }
    getMotorPosition({ PORT }) { return readSensor(PORT, "position", 0); }
    getMotorSpeed({ PORT })    { return readSensor(PORT, "speed", 0); }

    // ── Movement ──────────────────────────────────────────────────────────────────
    setMovementPair({ LEFT, RIGHT }) {
      leftPort = LEFT; rightPort = RIGHT;
      return send({ cmd: "movement.configure", left: LEFT, right: RIGHT });
    }
    startMoving({ SPEED }) {
      return send({ cmd: "movement.drive", left: leftPort, right: rightPort,
        speed: Cast.toNumber(SPEED), steering: 0 });
    }
    startMovingWithSteering({ SPEED, STEER }) {
      return send({ cmd: "movement.drive", left: leftPort, right: rightPort,
        speed: Cast.toNumber(SPEED), steering: Math.max(-100, Math.min(100, Cast.toNumber(STEER))) });
    }
    stopMoving() { return send({ cmd: "movement.stop", stop_action: "brake" }); }
    moveForDegrees({ DEG, SPEED }) {
      return send({ cmd: "movement.drive", left: leftPort, right: rightPort,
        speed: Cast.toNumber(SPEED), steering: 0,
        duration: Cast.toNumber(DEG), duration_unit: "degrees" });
    }
    moveForRotations({ ROT, SPEED }) {
      return send({ cmd: "movement.drive", left: leftPort, right: rightPort,
        speed: Cast.toNumber(SPEED), steering: 0,
        duration: Cast.toNumber(ROT), duration_unit: "rotations" });
    }
    setMovementAcceleration({ RATE }) {
      return send({ cmd: "movement.set_acceleration",
        rate: Math.max(0, Math.min(10000, Cast.toNumber(RATE))) });
    }

    // ── Light ──────────────────────────────────────────────────────────────────────
    showImage({ IMAGE }) {
      return send({ cmd: "led.matrix.image", port: "display", image: Cast.toString(IMAGE).toUpperCase() });
    }
    clearLightMatrix() { return send({ cmd: "led.matrix.clear", port: "display" }); }
    writeOnLightMatrix({ TEXT }) {
      return send({ cmd: "led.matrix.text", port: "display", text: Cast.toString(TEXT) });
    }
    setPixel({ X, Y, B }) {
      // Blocks use 1–5 (col/row); hub expects 0–4.
      return send({ cmd: "led.matrix.pixel", port: "display",
        x: Math.max(1, Math.min(5, Cast.toNumber(X))) - 1,
        y: Math.max(1, Math.min(5, Cast.toNumber(Y))) - 1,
        brightness: Math.max(0, Math.min(100, Cast.toNumber(B))) });
    }
    setLightMatrixBrightness({ LEVEL }) {
      return send({ cmd: "led.matrix.brightness", port: "display",
        level: Math.max(0, Math.min(100, Cast.toNumber(LEVEL))) });
    }
    setCenterButtonLight({ COLOR }) {
      return send({ cmd: "led.set", port: "status", color: Cast.toString(COLOR) });
    }
    lightUpDistanceSensor({ PORT, TL, TR, BL, BR }) {
      const c = (v) => Math.max(0, Math.min(100, Cast.toNumber(v)));
      return send({ cmd: "led.distance", port: PORT, tl: c(TL), tr: c(TR), bl: c(BL), br: c(BR) });
    }

    // ── Sensors (reporters & booleans use one-shot request/response) ────────────────
    getColor({ PORT })          { return readSensor(PORT, "color", ""); }
    getDistance({ PORT })       { return readSensor(PORT, "distance", -1); }
    getForce({ PORT })          { return readSensor(PORT, "force", 0); }
    getReflectedLight({ PORT }) { return readSensor(PORT, "reflected", 0); }

    async isColor({ PORT, COLOR }) {
      const ev = await requestEvent(
        { cmd: "sensor.read", port: PORT, type: "is_color", color: Cast.toString(COLOR).toLowerCase() },
        sensorMatch(PORT, "is_color"));
      return !!(ev && ev.value && ev.value.match);
    }
    async isCloserThan({ PORT, MM }) {
      const ev = await requestEvent(
        { cmd: "sensor.read", port: PORT, type: "is_closer", mm: Cast.toNumber(MM) },
        sensorMatch(PORT, "is_closer"));
      return !!(ev && ev.value);
    }
    async isReflectedLightAbove({ PORT, PCT }) {
      const ev = await requestEvent(
        { cmd: "sensor.read", port: PORT, type: "is_reflected_above", percent: Cast.toNumber(PCT) },
        sensorMatch(PORT, "is_reflected_above"));
      return !!(ev && ev.value);
    }
    isForceSensorPressed({ PORT }) {
      return requestEvent({ cmd: "sensor.read", port: PORT, type: "touched" },
        sensorMatch(PORT, "touched")).then((ev) => !!(ev && ev.value));
    }
    getTiltAngle({ AXIS }) { return readSensor("imu", Cast.toString(AXIS).toLowerCase(), 0); }
    async isTilted({ DIRECTION }) {
      const dir = Cast.toString(DIRECTION).toLowerCase();
      const ev = await requestEvent(
        { cmd: "sensor.read", port: "imu", type: "is_tilted", direction: dir },
        sensorMatch("imu", "is_tilted"));
      return !!(ev && ev.value && ev.value.tilted);
    }
    async isHubOrientation({ FACE }) {
      const ev = await requestEvent(
        { cmd: "sensor.read", port: "imu", type: "is_orientation", face: FACE },
        sensorMatch("imu", "is_orientation"));
      return !!(ev && ev.value && ev.value.match);
    }
    async isShaking() {
      const ev = await requestEvent({ cmd: "sensor.read", port: "imu", type: "is_shaking" },
        sensorMatch("imu", "is_shaking"));
      return !!(ev && ev.value);
    }
    async isHubButtonPressed({ BUTTON }) {
      const name = Cast.toString(BUTTON).toLowerCase();
      const ev = await requestEvent(
        { cmd: "system.read", metric: "is_button_pressed", button: name },
        systemMatch("is_button_pressed"));
      return !!(ev && ev.value && ev.value.pressed);
    }
    async getHubTimer() {
      const ev = await requestEvent({ cmd: "timer.get" }, sensorMatch("timer", "elapsed"));
      return ev ? ev.value : 0;
    }
    resetHubTimer() { return send({ cmd: "timer.reset" }); }

    whenColorRead({ PORT })    { const v = !!flags.colorChanged[PORT];    flags.colorChanged[PORT]    = false; return v; }
    whenDistanceRead({ PORT }) { const v = !!flags.distanceChanged[PORT]; flags.distanceChanged[PORT] = false; return v; }
    whenHubButtonPressed({ BUTTON }) {
      // Auto-subscribe on first poll so the user doesn't need a separate subscribe block.
      if (client && !btnSubscribed[BUTTON]) {
        btnSubscribed[BUTTON] = true;
        send({ cmd: "system.subscribe", metric: "button." + Cast.toString(BUTTON).toLowerCase(), interval: 100 });
      }
      const v = !!flags.buttonPressed[BUTTON];
      flags.buttonPressed[BUTTON] = false;
      return v;
    }
    whenHubButtonReleased({ BUTTON }) {
      if (client && !btnSubscribed[BUTTON]) {
        btnSubscribed[BUTTON] = true;
        send({ cmd: "system.subscribe", metric: "button." + Cast.toString(BUTTON).toLowerCase(), interval: 100 });
      }
      const v = !!flags.buttonReleased[BUTTON];
      flags.buttonReleased[BUTTON] = false;
      return v;
    }

    subscribeToColor({ PORT })    { return send({ cmd: "sensor.subscribe", port: PORT, type: "color",    mode: "on_change" }); }
    subscribeToDistance({ PORT }) { return send({ cmd: "sensor.subscribe", port: PORT, type: "distance", mode: "on_change" }); }
    subscribeToHubButton({ BUTTON }) {
      btnSubscribed[BUTTON] = true;
      return send({ cmd: "system.subscribe", metric: "button." + Cast.toString(BUTTON).toLowerCase(), interval: 100 });
    }

    // ── Sound ──────────────────────────────────────────────────────────────────────
    beep({ FREQ, DUR }) {
      return send({ cmd: "sound.beep", freq: Cast.toNumber(FREQ), duration: Cast.toNumber(DUR) });
    }
    startBeep({ FREQ }) { return send({ cmd: "sound.beep", freq: Cast.toNumber(FREQ) }); }
    stopAllSounds() { return send({ cmd: "sound.stop" }); }
    setVolume({ LEVEL }) {
      return send({ cmd: "sound.set_volume", level: Math.max(0, Math.min(100, Cast.toNumber(LEVEL))) });
    }
    async getVolume() {
      const ev = await requestEvent({ cmd: "sound.read", metric: "volume" },
        (e) => e.event === "sound" && e.metric === "volume");
      return ev ? ev.value : 0;
    }

    // ── System ──────────────────────────────────────────────────────────────────────
    // These reporters return the cached value (populated by system.subscribe started at connect).
    // First call after connect may return 0 until the first subscription event arrives (~5 s).
    getBatteryLevel()  { return sysCache.battery; }
    getTemperature()   { return sysCache.temperature; }
    isCharging()       { return sysCache.charging; }

    // ── Music (client-side tempo; await duration so notes sequence in Scratch) ───────
    async playNoteForBeats({ NOTE, BEATS }) {
      const midi = NOTE_MIDI[NOTE] ?? 69;
      const freq = Math.round(440 * Math.pow(2, (midi - 69) / 12));
      const ms   = Math.round((60000 / tempo) * Cast.toNumber(BEATS));
      await send({ cmd: "sound.beep", freq, duration: ms, wait: true });
      await waitMs(ms);
    }
    async restForBeats({ BEATS }) {
      const ms = Math.round((60000 / tempo) * Cast.toNumber(BEATS));
      await send({ cmd: "sound.rest", duration: ms });
      await waitMs(ms);
    }
    setTempo({ BPM })     { tempo = Math.max(1, Cast.toNumber(BPM)); }
    changeTempo({ DELTA }) { tempo = Math.max(1, tempo + Cast.toNumber(DELTA)); }
    getTempo()            { return tempo; }
  }

  Scratch.extensions.register(new SolariaSpikePrime());
})(Scratch);
