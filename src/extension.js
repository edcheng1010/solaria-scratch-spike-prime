// solaria-scratch-spike-prime — TurboWarp/PenguinMod unsandboxed extension.
// Block surface mirrors the 8-component App Inventor extension (SSP v0.8).
// Must run unsandboxed: requires navigator.bluetooth (Web Bluetooth API).
import { SpikeClient, WebBleTransport } from "@solaria/spike-prime";
import HUB_PROGRAM from "../../solaria-lib-spike-prime/hub/hub_controller.py";

(function (Scratch) {
  "use strict";
  if (!Scratch.extensions.unsandboxed) {
    throw new Error("solaria-spike-prime must run unsandboxed (needs Web Bluetooth).");
  }

  const { BlockType, ArgumentType, Cast } = Scratch;

  // ─── Constants (kept in sync with Java enums) ──────────────────────────────
  const PORTS       = ["A", "B", "C", "D", "E", "F"];
  const DIRECTIONS  = ["forward", "backward"];
  const STOP_ACTS   = ["brake", "hold", "coast"];
  const COLORS      = ["red", "orange", "yellow", "green", "cyan", "azure", "blue",
                        "violet", "magenta", "white", "black"];
  const HUB_FACES   = ["Top", "Bottom", "Front", "Back", "Left side", "Right side"];
  const HUB_BUTTONS = ["Left", "Right"];
  const TILT_DIRS   = ["forward", "backward", "left", "right"];
  const TILT_AXES   = ["pitch", "roll", "yaw"];
  const BTN_COLORS  = ["azure", "black", "blue", "cyan", "green", "magenta", "orange",
                        "red", "violet", "white", "yellow", "off"];
  const NOTES       = [
    "C3","Csharp3","D3","Dsharp3","E3","F3","Fsharp3","G3","Gsharp3","A3","Asharp3","B3",
    "C4","Csharp4","D4","Dsharp4","E4","Fsharp4","G4","Gsharp4","A4","Asharp4","B4",
    "C5","Csharp5","D5","Dsharp5","E5","F5","Fsharp5","G5","Gsharp5","A5","Asharp5","B5",
    "C6","Csharp6","D6","Dsharp6","E6","F6","Fsharp6","G6","Gsharp6","A6","Asharp6","B6",
    "C7",
  ];

  // Note name → MIDI number (C3 = MIDI 48)
  const NOTE_MIDI = {};
  const NOTE_NAMES = ["C","Csharp","D","Dsharp","E","F","Fsharp","G","Gsharp","A","Asharp","B"];
  NOTES.forEach((n) => {
    const octave = parseInt(n.slice(-1));
    const name   = n.slice(0, -1);
    NOTE_MIDI[n] = (octave + 1) * 12 + NOTE_NAMES.indexOf(name);
  });

  function menuOf(arr) { return arr.map((v) => ({ text: v, value: v })); }

  // ─── State cache ────────────────────────────────────────────────────────────
  let client = null;

  // Per-port sensor caches
  const cache = {
    color:      {},   // port → string
    distance:   {},   // port → number (mm)
    force:      {},   // port → number (N)
    motorPos:   {},   // port → number (deg)
    motorAbs:   {},   // port → number (deg)
    motorSpeed: {},   // port → number (%)
    // IMU
    pitch: 0, roll: 0, yaw: 0,
    tiltAngle: { pitch: 0, roll: 0, yaw: 0 },
    faceOrientation: "Top",
    hubOrientation: { pitch: 0, roll: 0, yaw: 0 },
    shaking: false,
    buttonState: { Left: false, Right: false },
    timer: 0,
    // System
    battery: 0, temperature: 0, charging: false, rssi: 0,
    volume: 50,
    // Music
    tempo: 120,
  };

  // Edge-trigger flags for hat blocks
  const flags = {
    hubConnected:     false,
    hubDisconnected:  false,
    hubDisconnectReason: "",
    colorChanged:     {},   // port → bool
    distanceChanged:  {},   // port → bool
    forceChanged:     {},   // port → bool
    motorDone:        {},   // port → bool
    hubTiltChanged:   false,
    hubOrientationChanged: false,
    hubShaking:       false,
    buttonPressed:    { Left: false, Right: false },
    buttonReleased:   { Left: false, Right: false },
  };

  function clearFlag(key) { flags[key] = false; }
  function clearPortFlag(map, port) { map[port] = false; }

  // ─── Event routing ──────────────────────────────────────────────────────────
  function handleClientEvent(ev) {
    if (ev.type === "connected") {
      flags.hubConnected = true;
      flags.hubDisconnected = false;
    } else if (ev.type === "disconnected") {
      flags.hubDisconnected = true;
      flags.hubDisconnectReason = ev.reason;
      client = null;
    } else if (ev.type === "ssp") {
      handleSSP(ev.event);
    }
  }

  function handleSSP(ev) {
    if (!ev) return;
    if (ev.event === "sensor") {
      const port = ev.port;
      const type = ev.type;
      const val  = ev.value;
      if (type === "color") {
        cache.color[port] = val;
        flags.colorChanged[port] = true;
      } else if (type === "distance") {
        cache.distance[port] = val;
        flags.distanceChanged[port] = true;
      } else if (type === "force") {
        cache.force[port] = val;
        flags.forceChanged[port] = true;
      } else if (type === "motor_position") {
        cache.motorPos[port] = val;
      } else if (type === "motor_abs_position") {
        cache.motorAbs[port] = val;
      } else if (type === "motor_speed") {
        cache.motorSpeed[port] = val;
      } else if (type === "motor_done") {
        flags.motorDone[port] = true;
      } else if (type === "tilt") {
        if (val && typeof val === "object") {
          cache.tiltAngle.pitch = val.pitch ?? cache.tiltAngle.pitch;
          cache.tiltAngle.roll  = val.roll  ?? cache.tiltAngle.roll;
          cache.tiltAngle.yaw   = val.yaw   ?? cache.tiltAngle.yaw;
          flags.hubTiltChanged = true;
        }
      } else if (type === "orientation") {
        if (val && typeof val === "object") {
          cache.hubOrientation = { pitch: val.pitch ?? 0, roll: val.roll ?? 0, yaw: val.yaw ?? 0 };
          flags.hubOrientationChanged = true;
        } else if (typeof val === "string") {
          cache.faceOrientation = val;
        }
      } else if (type === "shaking") {
        cache.shaking = !!val;
        if (cache.shaking) flags.hubShaking = true;
      } else if (type === "button") {
        if (val && typeof val === "object") {
          const btn = val.button;
          const pressed = !!val.pressed;
          if (btn === "Left" || btn === "Right") {
            const was = cache.buttonState[btn];
            cache.buttonState[btn] = pressed;
            if (pressed && !was)  flags.buttonPressed[btn]  = true;
            if (!pressed && was)  flags.buttonReleased[btn] = true;
          }
        }
      } else if (type === "timer") {
        cache.timer = typeof val === "number" ? val : 0;
      } else if (type === "is_color") {
        // one-shot boolean results handled separately — no cache needed
      } else if (type === "is_tilted") {
        // one-shot
      }
    } else if (ev.event === "system") {
      const m = ev.metric;
      if (m === "battery")      cache.battery     = ev.value ?? 0;
      if (m === "temperature")  cache.temperature = ev.value ?? 0;
      if (m === "charging")     cache.charging    = !!ev.value;
      if (m === "rssi")         cache.rssi        = ev.value ?? 0;
    } else if (ev.event === "sound" && ev.metric === "volume") {
      cache.volume = ev.value ?? cache.volume;
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function send(cmd) {
    if (!client) return Promise.resolve();
    return client.sendSSP(cmd).catch(() => {});
  }

  // Returns a promise that resolves to the next matching SSP event value, or
  // null after timeoutMs. Used for one-shot reads in reporter blocks.
  function awaitSensorValue(matchFn, timeoutMs = 3000) {
    return new Promise((resolve) => {
      if (!client) return resolve(null);
      const timer = setTimeout(() => { client.off(handler); resolve(null); }, timeoutMs);
      function handler(ev) {
        if (ev.type === "ssp" && matchFn(ev.event)) {
          clearTimeout(timer);
          client.off(handler);
          resolve(ev.event.value);
        }
      }
      client.on(handler);
    });
  }

  // ─── Main extension class ────────────────────────────────────────────────────
  class SolariaSpikePrime {
    getInfo() {
      return {
        id: "solariaspikeprime",
        name: "SPIKE Prime",
        color1: "#0090C8",
        color2: "#0082B5",
        blocks: [
          // ── CONNECTIVITY ──────────────────────────────────────────────────
          { blockType: BlockType.LABEL, text: "Connection" },

          {
            opcode: "connect",
            blockType: BlockType.COMMAND,
            text: "connect to SPIKE Prime",
          },
          {
            opcode: "disconnect",
            blockType: BlockType.COMMAND,
            text: "disconnect from hub",
          },
          {
            opcode: "isConnected",
            blockType: BlockType.BOOLEAN,
            text: "connected?",
          },
          {
            opcode: "whenHubConnected",
            blockType: BlockType.HAT,
            isEdgeActivated: false,
            text: "when hub connected",
          },
          {
            opcode: "whenHubDisconnected",
            blockType: BlockType.HAT,
            isEdgeActivated: false,
            text: "when hub disconnected",
          },

          "---",

          // ── MOTORS ────────────────────────────────────────────────────────
          { blockType: BlockType.LABEL, text: "Motors" },

          {
            opcode: "startMotor",
            blockType: BlockType.COMMAND,
            text: "start motor [PORT] [DIRECTION] at [SPEED] %",
            arguments: {
              PORT:      { type: ArgumentType.STRING, menu: "ports",      defaultValue: "A" },
              DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "forward" },
              SPEED:     { type: ArgumentType.NUMBER, defaultValue: 75 },
            },
          },
          {
            opcode: "stopMotor",
            blockType: BlockType.COMMAND,
            text: "stop motor [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } },
          },
          {
            opcode: "runMotorForSeconds",
            blockType: BlockType.COMMAND,
            text: "run motor [PORT] [DIRECTION] at [SPEED] % for [SECS] seconds",
            arguments: {
              PORT:      { type: ArgumentType.STRING, menu: "ports",      defaultValue: "A" },
              DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "forward" },
              SPEED:     { type: ArgumentType.NUMBER, defaultValue: 75 },
              SECS:      { type: ArgumentType.NUMBER, defaultValue: 1 },
            },
          },
          {
            opcode: "runMotorForDegrees",
            blockType: BlockType.COMMAND,
            text: "run motor [PORT] [DIRECTION] at [SPEED] % for [DEG] degrees",
            arguments: {
              PORT:      { type: ArgumentType.STRING, menu: "ports",      defaultValue: "A" },
              DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "forward" },
              SPEED:     { type: ArgumentType.NUMBER, defaultValue: 75 },
              DEG:       { type: ArgumentType.NUMBER, defaultValue: 360 },
            },
          },
          {
            opcode: "goToMotorPosition",
            blockType: BlockType.COMMAND,
            text: "go to motor [PORT] absolute position [POS] degrees at [SPEED] %",
            arguments: {
              PORT:  { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
              POS:   { type: ArgumentType.NUMBER, defaultValue: 0 },
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 75 },
            },
          },
          {
            opcode: "setMotorSpeed",
            blockType: BlockType.COMMAND,
            text: "set motor [PORT] default speed to [SPEED] %",
            arguments: {
              PORT:  { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 75 },
            },
          },
          {
            opcode: "setMotorAcceleration",
            blockType: BlockType.COMMAND,
            text: "set motor [PORT] acceleration to [RATE] %/s",
            arguments: {
              PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
              RATE: { type: ArgumentType.NUMBER, defaultValue: 100 },
            },
          },
          {
            opcode: "setMotorBrakeAtStop",
            blockType: BlockType.COMMAND,
            text: "set motor [PORT] stop action to [ACTION]",
            arguments: {
              PORT:   { type: ArgumentType.STRING, menu: "ports",       defaultValue: "A" },
              ACTION: { type: ArgumentType.STRING, menu: "stopActions", defaultValue: "brake" },
            },
          },
          {
            opcode: "resetMotorPosition",
            blockType: BlockType.COMMAND,
            text: "reset motor [PORT] position",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } },
          },
          {
            opcode: "getMotorPosition",
            blockType: BlockType.REPORTER,
            text: "motor [PORT] position (degrees)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } },
          },
          {
            opcode: "getMotorSpeed",
            blockType: BlockType.REPORTER,
            text: "motor [PORT] speed (%)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } },
          },
          {
            opcode: "whenMotorDone",
            blockType: BlockType.HAT,
            isEdgeActivated: false,
            text: "when motor [PORT] done",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } },
          },

          "---",

          // ── MOVEMENT ──────────────────────────────────────────────────────
          { blockType: BlockType.LABEL, text: "Movement" },

          {
            opcode: "setMovementPair",
            blockType: BlockType.COMMAND,
            text: "set movement motors [LEFT] (left) [RIGHT] (right)",
            arguments: {
              LEFT:  { type: ArgumentType.STRING, menu: "ports", defaultValue: "E" },
              RIGHT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "F" },
            },
          },
          {
            opcode: "startMoving",
            blockType: BlockType.COMMAND,
            text: "start moving at [SPEED] %",
            arguments: { SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 } },
          },
          {
            opcode: "startMovingWithSteering",
            blockType: BlockType.COMMAND,
            text: "start moving at [SPEED] % with steering [STEER]",
            arguments: {
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 },
              STEER: { type: ArgumentType.NUMBER, defaultValue: 0 },
            },
          },
          {
            opcode: "stopMoving",
            blockType: BlockType.COMMAND,
            text: "stop moving",
          },
          {
            opcode: "moveForDistance",
            blockType: BlockType.COMMAND,
            text: "move [DIST] cm at [SPEED] %",
            arguments: {
              DIST:  { type: ArgumentType.NUMBER, defaultValue: 10 },
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 },
            },
          },
          {
            opcode: "moveForDegrees",
            blockType: BlockType.COMMAND,
            text: "move for [DEG] degrees at [SPEED] %",
            arguments: {
              DEG:   { type: ArgumentType.NUMBER, defaultValue: 360 },
              SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 },
            },
          },
          {
            opcode: "setMovementSpeed",
            blockType: BlockType.COMMAND,
            text: "set movement speed to [SPEED] %",
            arguments: { SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 } },
          },
          {
            opcode: "setMovementAcceleration",
            blockType: BlockType.COMMAND,
            text: "set movement acceleration to [RATE] %/s",
            arguments: { RATE: { type: ArgumentType.NUMBER, defaultValue: 100 } },
          },

          "---",

          // ── LIGHT ─────────────────────────────────────────────────────────
          { blockType: BlockType.LABEL, text: "Light" },

          {
            opcode: "turnOnLightMatrix",
            blockType: BlockType.COMMAND,
            text: "turn on light matrix",
          },
          {
            opcode: "turnOffLightMatrix",
            blockType: BlockType.COMMAND,
            text: "turn off light matrix",
          },
          {
            opcode: "writeOnLightMatrix",
            blockType: BlockType.COMMAND,
            text: "write [TEXT] on light matrix",
            arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: "Hi" } },
          },
          {
            opcode: "setLightMatrixBrightness",
            blockType: BlockType.COMMAND,
            text: "set light matrix brightness to [LEVEL] %",
            arguments: { LEVEL: { type: ArgumentType.NUMBER, defaultValue: 100 } },
          },
          {
            opcode: "setCenterButtonLight",
            blockType: BlockType.COMMAND,
            text: "set center button light to [COLOR]",
            arguments: { COLOR: { type: ArgumentType.STRING, menu: "btnColors", defaultValue: "azure" } },
          },
          {
            opcode: "lightUpDistanceSensor",
            blockType: BlockType.COMMAND,
            text: "light up distance sensor at [PORT] brightness [B1] [B2] [B3] [B4]",
            arguments: {
              PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" },
              B1:   { type: ArgumentType.NUMBER, defaultValue: 100 },
              B2:   { type: ArgumentType.NUMBER, defaultValue: 100 },
              B3:   { type: ArgumentType.NUMBER, defaultValue: 100 },
              B4:   { type: ArgumentType.NUMBER, defaultValue: 100 },
            },
          },

          "---",

          // ── SENSORS ───────────────────────────────────────────────────────
          { blockType: BlockType.LABEL, text: "Sensors" },

          {
            opcode: "getColor",
            blockType: BlockType.REPORTER,
            text: "color at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } },
          },
          {
            opcode: "getDistance",
            blockType: BlockType.REPORTER,
            text: "distance at [PORT] (mm)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } },
          },
          {
            opcode: "getForce",
            blockType: BlockType.REPORTER,
            text: "force at [PORT] (N)",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "D" } },
          },
          {
            opcode: "isColor",
            blockType: BlockType.BOOLEAN,
            text: "color at [PORT] is [COLOR]?",
            arguments: {
              PORT:  { type: ArgumentType.STRING, menu: "ports",   defaultValue: "C" },
              COLOR: { type: ArgumentType.STRING, menu: "colors",  defaultValue: "red" },
            },
          },
          {
            opcode: "isCloserThan",
            blockType: BlockType.BOOLEAN,
            text: "distance at [PORT] closer than [MM] mm?",
            arguments: {
              PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" },
              MM:   { type: ArgumentType.NUMBER, defaultValue: 100 },
            },
          },
          {
            opcode: "isReflectedLightAbove",
            blockType: BlockType.BOOLEAN,
            text: "reflected light at [PORT] above [PCT] %?",
            arguments: {
              PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" },
              PCT:  { type: ArgumentType.NUMBER, defaultValue: 50 },
            },
          },
          {
            opcode: "isForceSensorPressed",
            blockType: BlockType.BOOLEAN,
            text: "force sensor at [PORT] pressed?",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "D" } },
          },
          {
            opcode: "getTiltAngle",
            blockType: BlockType.REPORTER,
            text: "hub tilt angle [AXIS]",
            arguments: { AXIS: { type: ArgumentType.STRING, menu: "tiltAxes", defaultValue: "pitch" } },
          },
          {
            opcode: "isTilted",
            blockType: BlockType.BOOLEAN,
            text: "hub tilted [DIRECTION]?",
            arguments: { DIRECTION: { type: ArgumentType.STRING, menu: "tiltDirs", defaultValue: "forward" } },
          },
          {
            opcode: "isHubOrientation",
            blockType: BlockType.BOOLEAN,
            text: "hub facing [FACE]?",
            arguments: { FACE: { type: ArgumentType.STRING, menu: "hubFaces", defaultValue: "Top" } },
          },
          {
            opcode: "isShaking",
            blockType: BlockType.BOOLEAN,
            text: "hub shaking?",
          },
          {
            opcode: "isHubButtonPressed",
            blockType: BlockType.BOOLEAN,
            text: "hub [BUTTON] button pressed?",
            arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } },
          },
          {
            opcode: "getHubTimer",
            blockType: BlockType.REPORTER,
            text: "hub timer (seconds)",
          },
          {
            opcode: "resetHubTimer",
            blockType: BlockType.COMMAND,
            text: "reset hub timer",
          },
          {
            opcode: "whenColorRead",
            blockType: BlockType.HAT,
            isEdgeActivated: false,
            text: "when color read at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } },
          },
          {
            opcode: "whenDistanceRead",
            blockType: BlockType.HAT,
            isEdgeActivated: false,
            text: "when distance read at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } },
          },
          {
            opcode: "whenHubButtonPressed",
            blockType: BlockType.HAT,
            isEdgeActivated: false,
            text: "when hub [BUTTON] button pressed",
            arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } },
          },
          {
            opcode: "whenHubButtonReleased",
            blockType: BlockType.HAT,
            isEdgeActivated: false,
            text: "when hub [BUTTON] button released",
            arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } },
          },
          {
            opcode: "subscribeToColor",
            blockType: BlockType.COMMAND,
            text: "subscribe to color sensor at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } },
          },
          {
            opcode: "subscribeToDistance",
            blockType: BlockType.COMMAND,
            text: "subscribe to distance sensor at [PORT]",
            arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } },
          },
          {
            opcode: "subscribeToHubTilt",
            blockType: BlockType.COMMAND,
            text: "subscribe to hub tilt",
          },
          {
            opcode: "subscribeToHubButton",
            blockType: BlockType.COMMAND,
            text: "subscribe to hub [BUTTON] button",
            arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } },
          },

          "---",

          // ── SOUND ─────────────────────────────────────────────────────────
          { blockType: BlockType.LABEL, text: "Sound" },

          {
            opcode: "beep",
            blockType: BlockType.COMMAND,
            text: "beep at [FREQ] Hz for [DUR] ms",
            arguments: {
              FREQ: { type: ArgumentType.NUMBER, defaultValue: 440 },
              DUR:  { type: ArgumentType.NUMBER, defaultValue: 500 },
            },
          },
          {
            opcode: "startBeep",
            blockType: BlockType.COMMAND,
            text: "start beeping at [FREQ] Hz",
            arguments: { FREQ: { type: ArgumentType.NUMBER, defaultValue: 440 } },
          },
          {
            opcode: "stopAllSounds",
            blockType: BlockType.COMMAND,
            text: "stop all sounds",
          },
          {
            opcode: "setVolume",
            blockType: BlockType.COMMAND,
            text: "set hub volume to [LEVEL] %",
            arguments: { LEVEL: { type: ArgumentType.NUMBER, defaultValue: 50 } },
          },
          {
            opcode: "getVolume",
            blockType: BlockType.REPORTER,
            text: "hub volume (%)",
          },

          "---",

          // ── SYSTEM ────────────────────────────────────────────────────────
          { blockType: BlockType.LABEL, text: "System" },

          {
            opcode: "getBatteryLevel",
            blockType: BlockType.REPORTER,
            text: "hub battery (%)",
          },
          {
            opcode: "getTemperature",
            blockType: BlockType.REPORTER,
            text: "hub temperature (°C)",
          },
          {
            opcode: "isCharging",
            blockType: BlockType.BOOLEAN,
            text: "hub charging?",
          },
          {
            opcode: "getRSSI",
            blockType: BlockType.REPORTER,
            text: "hub RSSI (dBm)",
          },

          "---",

          // ── MUSIC ─────────────────────────────────────────────────────────
          { blockType: BlockType.LABEL, text: "Music" },

          {
            opcode: "playNoteForBeats",
            blockType: BlockType.COMMAND,
            text: "play note [NOTE] for [BEATS] beats",
            arguments: {
              NOTE:  { type: ArgumentType.STRING, menu: "notes", defaultValue: "A4" },
              BEATS: { type: ArgumentType.NUMBER, defaultValue: 1 },
            },
          },
          {
            opcode: "restForBeats",
            blockType: BlockType.COMMAND,
            text: "rest for [BEATS] beats",
            arguments: { BEATS: { type: ArgumentType.NUMBER, defaultValue: 1 } },
          },
          {
            opcode: "setTempo",
            blockType: BlockType.COMMAND,
            text: "set tempo to [BPM] BPM",
            arguments: { BPM: { type: ArgumentType.NUMBER, defaultValue: 120 } },
          },
          {
            opcode: "changeTempo",
            blockType: BlockType.COMMAND,
            text: "change tempo by [DELTA] BPM",
            arguments: { DELTA: { type: ArgumentType.NUMBER, defaultValue: 10 } },
          },
          {
            opcode: "getTempo",
            blockType: BlockType.REPORTER,
            text: "tempo (BPM)",
          },
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
          notes:       { acceptReporters: true, items: menuOf(NOTES) },
        },
      };
    }

    // ── CONNECTIVITY ──────────────────────────────────────────────────────────
    async connect() {
      try {
        const transport = new WebBleTransport();
        client = new SpikeClient(transport, HUB_PROGRAM);
        client.on(handleClientEvent);
        await client.connect();
      } catch (e) {
        client = null;
        console.error("[SolariaSpikePrime] connect error:", e);
      }
    }
    async disconnect() {
      if (client) await client.disconnect().catch(() => {});
    }
    isConnected()           { return !!client; }
    whenHubConnected()      { const v = flags.hubConnected;     flags.hubConnected     = false; return v; }
    whenHubDisconnected()   { const v = flags.hubDisconnected;  flags.hubDisconnected  = false; return v; }

    // ── MOTORS ────────────────────────────────────────────────────────────────
    startMotor({ PORT, DIRECTION, SPEED }) {
      return send({ cmd: "motor.run", port: PORT, speed: DIRECTION === "backward" ? -Math.abs(+SPEED) : Math.abs(+SPEED) });
    }
    stopMotor({ PORT }) {
      return send({ cmd: "motor.stop", port: PORT });
    }
    runMotorForSeconds({ PORT, DIRECTION, SPEED, SECS }) {
      const spd = DIRECTION === "backward" ? -Math.abs(+SPEED) : Math.abs(+SPEED);
      return send({ cmd: "motor.run_for_time", port: PORT, speed: spd, ms: Math.round(Cast.toNumber(SECS) * 1000) });
    }
    runMotorForDegrees({ PORT, DIRECTION, SPEED, DEG }) {
      const spd = DIRECTION === "backward" ? -Math.abs(+SPEED) : Math.abs(+SPEED);
      return send({ cmd: "motor.run_for_degrees", port: PORT, speed: spd, degrees: Cast.toNumber(DEG) });
    }
    goToMotorPosition({ PORT, POS, SPEED }) {
      return send({ cmd: "motor.run_to_position", port: PORT, position: Cast.toNumber(POS), speed: Cast.toNumber(SPEED) });
    }
    setMotorSpeed({ PORT, SPEED }) {
      return send({ cmd: "motor.set_default_speed", port: PORT, speed: Cast.toNumber(SPEED) });
    }
    setMotorAcceleration({ PORT, RATE }) {
      return send({ cmd: "motor.set_acceleration", port: PORT, rate: Cast.toNumber(RATE) });
    }
    setMotorBrakeAtStop({ PORT, ACTION }) {
      return send({ cmd: "motor.set_stop_action", port: PORT, action: ACTION });
    }
    resetMotorPosition({ PORT }) {
      return send({ cmd: "motor.reset_position", port: PORT });
    }
    getMotorPosition({ PORT }) { return cache.motorPos[PORT]   ?? 0; }
    getMotorSpeed({ PORT })    { return cache.motorSpeed[PORT]  ?? 0; }
    whenMotorDone({ PORT })    { const v = !!flags.motorDone[PORT]; flags.motorDone[PORT] = false; return v; }

    // ── MOVEMENT ──────────────────────────────────────────────────────────────
    setMovementPair({ LEFT, RIGHT }) {
      return send({ cmd: "movement.configure", left_port: LEFT, right_port: RIGHT });
    }
    startMoving({ SPEED }) {
      return send({ cmd: "movement.start", speed: Cast.toNumber(SPEED) });
    }
    startMovingWithSteering({ SPEED, STEER }) {
      return send({ cmd: "movement.start_with_steering", speed: Cast.toNumber(SPEED), steering: Cast.toNumber(STEER) });
    }
    stopMoving() {
      return send({ cmd: "movement.stop" });
    }
    moveForDistance({ DIST, SPEED }) {
      return send({ cmd: "movement.move_for_distance", distance: Cast.toNumber(DIST), speed: Cast.toNumber(SPEED) });
    }
    moveForDegrees({ DEG, SPEED }) {
      return send({ cmd: "movement.move_for_degrees", degrees: Cast.toNumber(DEG), speed: Cast.toNumber(SPEED) });
    }
    setMovementSpeed({ SPEED }) {
      return send({ cmd: "movement.set_speed", speed: Cast.toNumber(SPEED) });
    }
    setMovementAcceleration({ RATE }) {
      return send({ cmd: "movement.set_acceleration", rate: Cast.toNumber(RATE) });
    }

    // ── LIGHT ─────────────────────────────────────────────────────────────────
    turnOnLightMatrix()          { return send({ cmd: "led.matrix.on" }); }
    turnOffLightMatrix()         { return send({ cmd: "led.matrix.off" }); }
    writeOnLightMatrix({ TEXT }) { return send({ cmd: "led.matrix.write", text: Cast.toString(TEXT) }); }
    setLightMatrixBrightness({ LEVEL }) {
      return send({ cmd: "led.matrix.brightness", level: Cast.toNumber(LEVEL) });
    }
    setCenterButtonLight({ COLOR }) {
      return send({ cmd: "led.center", color: COLOR });
    }
    lightUpDistanceSensor({ PORT, B1, B2, B3, B4 }) {
      return send({ cmd: "led.distance", port: PORT,
        brightness: [Cast.toNumber(B1), Cast.toNumber(B2), Cast.toNumber(B3), Cast.toNumber(B4)] });
    }

    // ── SENSORS ───────────────────────────────────────────────────────────────
    getColor({ PORT })    { return cache.color[PORT]    ?? ""; }
    getDistance({ PORT }) { return cache.distance[PORT] ?? 0;  }
    getForce({ PORT })    { return cache.force[PORT]    ?? 0;  }

    isColor({ PORT, COLOR }) {
      return (cache.color[PORT] ?? "").toLowerCase() === Cast.toString(COLOR).toLowerCase();
    }
    isCloserThan({ PORT, MM }) {
      const d = cache.distance[PORT];
      return d != null && d < Cast.toNumber(MM);
    }
    isReflectedLightAbove({ PORT, PCT }) {
      // reflected light is reported as a distance-sensor reading 0–100
      const d = cache.distance[PORT];
      return d != null && d > Cast.toNumber(PCT);
    }
    isForceSensorPressed({ PORT }) {
      return (cache.force[PORT] ?? 0) > 0;
    }
    getTiltAngle({ AXIS }) {
      return cache.tiltAngle[AXIS] ?? 0;
    }
    isTilted({ DIRECTION }) {
      const { pitch, roll } = cache.tiltAngle;
      const t = 20; // degrees threshold (matches Java)
      switch (DIRECTION) {
        case "forward":  return pitch >  t;
        case "backward": return pitch < -t;
        case "left":     return roll  < -t;
        case "right":    return roll  >  t;
      }
      return false;
    }
    isHubOrientation({ FACE }) {
      return cache.faceOrientation === FACE;
    }
    isShaking()  { return cache.shaking; }
    isHubButtonPressed({ BUTTON }) { return cache.buttonState[BUTTON] ?? false; }
    getHubTimer() { return cache.timer; }
    resetHubTimer() { return send({ cmd: "sensor.reset", type: "timer", port: "imu" }); }

    whenColorRead({ PORT })    { const v = !!flags.colorChanged[PORT];    flags.colorChanged[PORT]    = false; return v; }
    whenDistanceRead({ PORT }) { const v = !!flags.distanceChanged[PORT]; flags.distanceChanged[PORT] = false; return v; }
    whenHubButtonPressed({ BUTTON })  { const v = !!flags.buttonPressed[BUTTON];  flags.buttonPressed[BUTTON]  = false; return v; }
    whenHubButtonReleased({ BUTTON }) { const v = !!flags.buttonReleased[BUTTON]; flags.buttonReleased[BUTTON] = false; return v; }

    subscribeToColor({ PORT })    { return send({ cmd: "sensor.subscribe", type: "color",    port: PORT }); }
    subscribeToDistance({ PORT }) { return send({ cmd: "sensor.subscribe", type: "distance", port: PORT }); }
    subscribeToHubTilt()          { return send({ cmd: "sensor.subscribe", type: "tilt",     port: "imu" }); }
    subscribeToHubButton({ BUTTON }) {
      return send({ cmd: "sensor.subscribe", type: "button", port: "imu",
        button: Cast.toString(BUTTON).toLowerCase() });
    }

    // ── SOUND ─────────────────────────────────────────────────────────────────
    beep({ FREQ, DUR }) {
      return send({ cmd: "sound.beep", freq: Cast.toNumber(FREQ), duration: Cast.toNumber(DUR) });
    }
    startBeep({ FREQ }) {
      return send({ cmd: "sound.beep_start", freq: Cast.toNumber(FREQ) });
    }
    stopAllSounds() { return send({ cmd: "sound.stop" }); }
    setVolume({ LEVEL }) {
      cache.volume = Cast.toNumber(LEVEL);
      return send({ cmd: "sound.set_volume", level: Cast.toNumber(LEVEL) });
    }
    getVolume() { return cache.volume; }

    // ── SYSTEM ────────────────────────────────────────────────────────────────
    getBatteryLevel()  { send({ cmd: "system.read", metric: "battery" });     return cache.battery;     }
    getTemperature()   { send({ cmd: "system.read", metric: "temperature" }); return cache.temperature; }
    isCharging()       { send({ cmd: "system.read", metric: "charging" });    return cache.charging;    }
    getRSSI()          { send({ cmd: "system.read", metric: "rssi" });        return cache.rssi;        }

    // ── MUSIC ─────────────────────────────────────────────────────────────────
    playNoteForBeats({ NOTE, BEATS }) {
      const midi = NOTE_MIDI[NOTE] ?? 69; // A4 default
      const freq = Math.round(440 * Math.pow(2, (midi - 69) / 12));
      const ms   = Math.round((60000 / cache.tempo) * Cast.toNumber(BEATS));
      return send({ cmd: "sound.beep", freq, duration: ms, wait: true });
    }
    restForBeats({ BEATS }) {
      const ms = Math.round((60000 / cache.tempo) * Cast.toNumber(BEATS));
      return send({ cmd: "sound.rest", duration: ms });
    }
    setTempo({ BPM })    { cache.tempo = Math.max(1, Cast.toNumber(BPM)); }
    changeTempo({ DELTA }) { cache.tempo = Math.max(1, cache.tempo + Cast.toNumber(DELTA)); }
    getTempo()           { return cache.tempo; }
  }

  Scratch.extensions.register(new SolariaSpikePrime());
})(Scratch);
