// solaria-scratch-spike-prime — AUTO-GENERATED, do not edit.
// Source: src/extension.js  •  Built with: node build.js
// Unofficial LEGO® SPIKE™ Prime extension for TurboWarp/PenguinMod.
(() => {
  // ../solaria-lib-spike-prime/web/src/cobs.ts
  var DELIMITER = 2;
  var NO_DELIMITER = 255;
  var MAX_BLOCK_SIZE = 84;
  var COBS_CODE_OFFSET = 2;
  var XOR = 3;
  function encode(data) {
    const buf = new Uint8Array(data.length * 2 + 2);
    let bufLen = 0;
    let codeIndex = bufLen;
    buf[bufLen++] = NO_DELIMITER;
    let block = 1;
    for (let idx = 0; idx < data.length; idx++) {
      const b = data[idx] & 255;
      if (b > DELIMITER) {
        buf[bufLen++] = b;
        block++;
      }
      if (b <= DELIMITER || block > MAX_BLOCK_SIZE) {
        if (b <= DELIMITER) {
          const delimiterBase = b * MAX_BLOCK_SIZE;
          const blockOffset = block + COBS_CODE_OFFSET;
          buf[codeIndex] = delimiterBase + blockOffset & 255;
        }
        codeIndex = bufLen;
        buf[bufLen++] = NO_DELIMITER;
        block = 1;
      }
    }
    buf[codeIndex] = block + COBS_CODE_OFFSET & 255;
    return buf.subarray(0, bufLen);
  }
  function decode(data) {
    const buf = new Uint8Array(data.length);
    let bufLen = 0;
    let [value, block] = unescape(data[0] & 255);
    for (let i = 1; i < data.length; i++) {
      const b = data[i] & 255;
      block--;
      if (block > 0) {
        buf[bufLen++] = b;
        continue;
      }
      if (value !== -1) {
        buf[bufLen++] = value & 255;
      }
      [value, block] = unescape(b);
    }
    return buf.subarray(0, bufLen);
  }
  function unescape(code) {
    if (code === NO_DELIMITER) {
      return [-1, MAX_BLOCK_SIZE + 1];
    }
    const div = code - COBS_CODE_OFFSET;
    let value = Math.floor(div / MAX_BLOCK_SIZE);
    let blk = div % MAX_BLOCK_SIZE;
    if (blk === 0) {
      blk = MAX_BLOCK_SIZE;
      value -= 1;
    }
    return [value, blk];
  }

  // ../solaria-lib-spike-prime/web/src/framing.ts
  var FRAME_START = 1;
  function pack(raw) {
    const cobs = encode(raw);
    const out = new Uint8Array(cobs.length + 2);
    out[0] = FRAME_START;
    for (let i = 0; i < cobs.length; i++) out[i + 1] = (cobs[i] ^ XOR) & 255;
    out[out.length - 1] = DELIMITER;
    return out;
  }
  function unpack(frame) {
    const start = frame[0] === FRAME_START ? 1 : 0;
    const bodyLen = frame.length - start - 1;
    const unxored = new Uint8Array(bodyLen);
    for (let i = 0; i < bodyLen; i++) unxored[i] = (frame[start + i] ^ XOR) & 255;
    return decode(unxored);
  }

  // ../solaria-lib-spike-prime/web/src/crc32.ts
  var TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n >>> 0;
      for (let k = 0; k < 8; k++) c = c & 1 ? (3988292384 ^ c >>> 1) >>> 0 : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function calculate(data, seed = 0) {
    const pad = (4 - data.length % 4) % 4;
    let state = (seed ^ 4294967295) >>> 0;
    const run = (b) => {
      state = (state >>> 8 ^ TABLE[(state ^ b) & 255]) >>> 0;
    };
    for (let i = 0; i < data.length; i++) run(data[i] & 255);
    for (let i = 0; i < pad; i++) run(0);
    return (state ^ 4294967295) >>> 0;
  }
  function toLE(crc) {
    return new Uint8Array([crc & 255, crc >>> 8 & 255, crc >>> 16 & 255, crc >>> 24 & 255]);
  }

  // ../solaria-lib-spike-prime/web/src/messages.ts
  var enc = new TextEncoder();
  function infoRequest() {
    return new Uint8Array([0]);
  }
  function clearSlot(slot) {
    return new Uint8Array([70, slot & 255]);
  }
  function startFileUpload(name, slot, programBytes) {
    const n = enc.encode(name);
    const crc = toLE(calculate(programBytes, 0));
    const out = new Uint8Array(1 + n.length + 1 + 1 + 4);
    let i = 0;
    out[i++] = 12;
    out.set(n, i);
    i += n.length;
    out[i++] = 0;
    out[i++] = slot & 255;
    out.set(crc, i);
    return out;
  }
  function transferChunk(chunk, runningCRC) {
    const out = new Uint8Array(1 + 4 + 2 + chunk.length);
    out[0] = 16;
    out.set(toLE(runningCRC), 1);
    out[5] = chunk.length & 255;
    out[6] = chunk.length >>> 8 & 255;
    out.set(chunk, 7);
    return out;
  }
  function programFlow(stop, slot) {
    return new Uint8Array([30, stop ? 1 : 0, slot & 255]);
  }
  function tunnel(payload) {
    const p = enc.encode(payload);
    const out = new Uint8Array(3 + p.length);
    out[0] = 50;
    out[1] = p.length & 255;
    out[2] = p.length >>> 8 & 255;
    out.set(p, 3);
    return out;
  }

  // ../solaria-lib-spike-prime/web/src/uploader.ts
  var enc2 = new TextEncoder();
  function buildUpload(programText, slot, maxChunkSize) {
    const bytes = enc2.encode(programText);
    const chunks = [];
    let running = 0;
    for (let off = 0; off < bytes.length; off += maxChunkSize) {
      const chunk = bytes.subarray(off, Math.min(off + maxChunkSize, bytes.length));
      running = calculate(chunk, running);
      chunks.push(pack(transferChunk(chunk, running)));
    }
    return {
      clear: pack(clearSlot(slot)),
      start: pack(startFileUpload("program.py", slot, bytes)),
      chunks,
      execute: pack(programFlow(false, slot))
    };
  }

  // ../solaria-lib-spike-prime/web/src/ssp.ts
  function buildCommand(cmd) {
    return JSON.stringify(cmd) + "\n";
  }
  function parseEvents(payload) {
    const out = [];
    for (const line of payload.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      try {
        out.push(JSON.parse(s));
      } catch {
      }
    }
    return out;
  }

  // ../solaria-lib-spike-prime/web/src/client.ts
  var CONTROLLER_SLOT = 0;
  var HEARTBEAT_MS = 5e3;
  var PONG_TIMEOUT_MS = 1e4;
  var PREFS_KEY_PREFIX = "solaria_phash_";
  function parseInfoResponse(raw) {
    if (raw.length < 17 || raw[0] !== 1) return null;
    const u16le = (o) => raw[o] | raw[o + 1] << 8;
    return {
      fwMajor: raw[5],
      fwMinor: raw[6],
      fwBuild: u16le(7),
      maxPacketSize: u16le(9),
      maxMessageSize: u16le(11),
      maxChunkSize: u16le(13)
    };
  }
  function parseStatusOk(raw) {
    return raw.length >= 2 && raw[1] === 0;
  }
  function djb2(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) >>> 0;
    return h.toString(16);
  }
  var SpikeClient = class {
    constructor(transport, hubProgram) {
      this.transport = transport;
      this.hubProgram = hubProgram;
      // RX reassembly
      this.rxBuffer = [];
      // Pending one-shot waiters
      this.infoWaiter = null;
      this.uploadAckQueue = [];
      this.capabilityWaiter = null;
      // Listeners
      this.listeners = [];
      // Heartbeat
      this.lastPong = 0;
      // Device identity (set after BLE pairing — used for hash cache key)
      this.deviceId = "unknown";
      this.programHash = djb2(hubProgram);
    }
    on(cb) {
      this.listeners.push(cb);
    }
    off(cb) {
      const i = this.listeners.indexOf(cb);
      if (i >= 0) this.listeners.splice(i, 1);
    }
    // Full connect lifecycle. MUST be called from a user gesture (Web Bluetooth).
    async connect() {
      this.transport.onReceive((b) => this.onBytes(b));
      await this.transport.connect();
      const info = await this.sendAndAwait(
        pack(infoRequest()),
        (resolve) => {
          this.infoWaiter = resolve;
        },
        5e3,
        "InfoResponse timeout"
      );
      this.transport.maxPacketSize = info.maxPacketSize || 20;
      const maxChunk = info.maxChunkSize || 960;
      this.log(`FW ${info.fwMajor}.${info.fwMinor}.${info.fwBuild}  maxPacket=${this.transport.maxPacketSize}  maxChunk=${maxChunk}`);
      const cached = this.getCachedHash(this.deviceId);
      if (cached === this.programHash) {
        this.log("hash match \u2014 fast path (ProgramFlow only)");
        await this.transport.write(pack(programFlow(false, CONTROLLER_SLOT)));
        const cap2 = await this.awaitCapability(4e3).catch(() => null);
        if (cap2) {
          this.emit({ type: "connected", deviceName: this.deviceId, capability: cap2 });
          this.startHeartbeat();
          return;
        }
        this.log("fast path failed \u2014 falling through to full upload");
      }
      const frames = buildUpload(this.hubProgram, CONTROLLER_SLOT, maxChunk);
      await this.transport.write(frames.clear);
      await this.awaitUploadAck(3e3).catch(() => {
      });
      await this.transport.write(frames.start);
      const startAck = await this.awaitUploadAck(5e3);
      if (!parseStatusOk(startAck)) throw new Error("StartFileUpload rejected by hub");
      for (let i = 0; i < frames.chunks.length; i++) {
        await this.transport.write(frames.chunks[i]);
        const chunkAck = await this.awaitUploadAck(5e3);
        if (!parseStatusOk(chunkAck)) throw new Error(`Chunk ${i + 1}/${frames.chunks.length} rejected`);
      }
      this.log(`${frames.chunks.length} chunk(s) uploaded`);
      await this.transport.write(frames.execute);
      await this.awaitUploadAck(5e3).catch(() => {
      });
      this.setCachedHash(this.deviceId, this.programHash);
      const cap = await this.awaitCapability(3e3).catch(() => ({}));
      this.emit({ type: "connected", deviceName: this.deviceId, capability: cap });
      this.startHeartbeat();
    }
    async sendSSP(cmd) {
      await this.transport.write(pack(tunnel(buildCommand(cmd))));
    }
    async disconnect() {
      this.stopHeartbeat();
      await this.transport.disconnect();
      this.emit({ type: "disconnected", reason: "user" });
    }
    // ─── RX reassembly ──────────────────────────────────────────────────────────
    onBytes(bytes) {
      for (const b of bytes) {
        this.rxBuffer.push(b);
        if (b === 2) {
          const frame = Uint8Array.from(this.rxBuffer);
          this.rxBuffer = [];
          try {
            this.handleFrame(unpack(frame));
          } catch {
          }
        }
      }
    }
    handleFrame(raw) {
      if (raw.length === 0) return;
      const msgId = raw[0];
      if (msgId === 1) {
        const info = parseInfoResponse(raw);
        if (info && this.infoWaiter) {
          this.infoWaiter(info);
          this.infoWaiter = null;
        }
      } else if (msgId === 13 || msgId === 17 || msgId === 31 || msgId === 71) {
        const waiter = this.uploadAckQueue.shift();
        if (waiter) waiter(raw);
      } else if (msgId === 32) {
        if (raw.length >= 2)
          this.log(`ProgramFlow: ${raw[1] === 0 ? "started" : "stopped"}`);
      } else if (msgId === 33) {
        if (raw.length > 1) {
          let len = raw.length - 1;
          while (len > 0 && raw[len] === 0) len--;
          this.log("HUB PRINT: " + new TextDecoder().decode(raw.subarray(1, len + 1)).trim());
        }
      } else if (msgId === 50) {
        if (raw.length < 3) return;
        const size = raw[1] | raw[2] << 8;
        const text = new TextDecoder().decode(raw.subarray(3, 3 + size)).trim();
        if (!text || text === "rdy" || text === "err") return;
        for (const ev of parseEvents(text)) {
          const any = ev;
          if (any["type"] === "capability" && this.capabilityWaiter) {
            this.capabilityWaiter(any);
            this.capabilityWaiter = null;
          }
          if (any["event"] === "pong") this.lastPong = performance.now();
          this.emit({ type: "ssp", event: ev });
        }
      }
    }
    // ─── Heartbeat ──────────────────────────────────────────────────────────────
    startHeartbeat() {
      this.lastPong = performance.now();
      this.heartbeat = setInterval(() => {
        this.sendSSP({ cmd: "system.ping" }).catch(() => {
        });
        if (performance.now() - this.lastPong > PONG_TIMEOUT_MS) {
          this.stopHeartbeat();
          this.emit({ type: "disconnected", reason: "heartbeat_lost" });
        }
      }, HEARTBEAT_MS);
    }
    stopHeartbeat() {
      if (this.heartbeat != null) {
        clearInterval(this.heartbeat);
        this.heartbeat = void 0;
      }
    }
    // ─── Promise helpers ────────────────────────────────────────────────────────
    sendAndAwait(msg, registerWaiter, timeoutMs, timeoutMsg) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs);
        registerWaiter((v) => {
          clearTimeout(timer);
          resolve(v);
        });
        this.transport.write(msg).catch(reject);
      });
    }
    awaitUploadAck(timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = this.uploadAckQueue.indexOf(resolve);
          if (idx >= 0) this.uploadAckQueue.splice(idx, 1);
          reject(new Error("Upload ack timeout"));
        }, timeoutMs);
        this.uploadAckQueue.push((raw) => {
          clearTimeout(timer);
          resolve(raw);
        });
      });
    }
    awaitCapability(timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.capabilityWaiter = null;
          reject(new Error("Capability timeout"));
        }, timeoutMs);
        this.capabilityWaiter = (cap) => {
          clearTimeout(timer);
          resolve(cap);
        };
      });
    }
    // ─── Program hash cache (localStorage, keyed by BLE device ID) ──────────────
    getCachedHash(deviceId) {
      try {
        return localStorage.getItem(PREFS_KEY_PREFIX + deviceId);
      } catch {
        return null;
      }
    }
    setCachedHash(deviceId, hash) {
      try {
        localStorage.setItem(PREFS_KEY_PREFIX + deviceId, hash);
      } catch {
      }
    }
    // ─── Internal helpers ────────────────────────────────────────────────────────
    emit(e) {
      this.listeners.forEach((l) => l(e));
    }
    log(msg) {
      console.debug("[SpikeClient]", msg);
    }
  };

  // ../solaria-lib-spike-prime/web/src/transport-webble.ts
  var SERVICE_UUID = "0000fd02-0000-1000-8000-00805f9b34fb";
  var RX_UUID = "0000fd02-0001-1000-8000-00805f9b34fb";
  var TX_UUID = "0000fd02-0002-1000-8000-00805f9b34fb";
  var WebBleTransport = class {
    constructor() {
      this.maxPacketSize = 20;
    }
    // MUST be called from a user gesture (block click).
    async connect() {
      const dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: [SERVICE_UUID] }]
      });
      const gatt = await dev.gatt.connect();
      const svc = await gatt.getPrimaryService(SERVICE_UUID);
      this.rx = await svc.getCharacteristic(RX_UUID);
      this.tx = await svc.getCharacteristic(TX_UUID);
      await this.tx.startNotifications();
      this.tx.addEventListener("characteristicvaluechanged", (e) => {
        var _a;
        const dv = e.target.value;
        (_a = this.rxCb) == null ? void 0 : _a.call(this, new Uint8Array(dv.buffer));
      });
    }
    async disconnect() {
    }
    async write(framed) {
      if (!this.rx) throw new Error("not connected");
      for (let i = 0; i < framed.length; i += this.maxPacketSize) {
        const slice = framed.subarray(i, Math.min(i + this.maxPacketSize, framed.length));
        await this.rx.writeValueWithoutResponse(new Uint8Array(slice));
      }
    }
    onReceive(cb) {
      this.rxCb = cb;
    }
  };

  // ../solaria-lib-spike-prime/hub/hub_controller.py
  var hub_controller_default = `# LEGO SPIKE Prime hub controller \u2014 SSP v0.8 edition.\r
#\r
# Wire format: SSP v0.8 json-utf8-newline over TunnelMessage (opcode 0x32).\r
# Each incoming frame is one newline-terminated JSON string.\r
# Each outgoing event is one newline-terminated JSON string.\r
#\r
# This program is the TYPE 2 "bridge firmware" for the Solaria platform.\r
# It runs entirely on the hub via the Python TunnelMessage facility.\r
#\r
# See: https://github.com/edcheng1010/solaria-hub/blob/main/spec/SSP-v0.8.md\r
#\r
# SSP v0.8 compliance notes:\r
#   STANDARD: motor.*, movement.*, led.matrix.*, led.set/off, sound.beep/play/stop/\r
#             set_volume/read, sensor.subscribe/unsubscribe/read, system.ping/info/\r
#             subscribe/unsubscribe/read/reset, orientation.*\r
#   STUB:     system.dfu \u2014 returns error 501 (firmware update not supported here)\r
#   UNSUPPORTED: batch \u2014 declared supports_batch:false in capability\r
#\r
# Non-standard extensions (not in SSP v0.8 spec, implemented for App Inventor bridge):\r
#   timer.get / timer.reset  \u2014 hub-side elapsed timer (replaces client-side clock)\r
#   led.distance             \u2014 distance sensor indicator LEDs (4-pixel array)\r
#   led.matrix.rotate        \u2014 incremental rotation (complement to led.matrix.orientation)\r
#   sound.rest               \u2014 blocking silence for music sequencing\r
\r
import hub, motor, motor_pair, time, math\r
from hub import light_matrix, port\r
\r
try:\r
    import json\r
    _json_ok = True\r
except ImportError:\r
    _json_ok = False\r
\r
try:\r
    import color_sensor, distance_sensor, force_sensor, color\r
    _CLR_MAP = {}\r
    for _n in ('BLACK', 'RED', 'GREEN', 'YELLOW', 'BLUE', 'WHITE',\r
               'CYAN', 'MAGENTA', 'ORANGE', 'VIOLET', 'AZURE', 'NONE'):\r
        try:\r
            _CLR_MAP[getattr(color, _n)] = _n.lower()\r
        except AttributeError:\r
            pass\r
    _sensors_ok = True\r
except Exception:\r
    _sensors_ok = False\r
    _CLR_MAP = {}\r
\r
# ---------------------------------------------------------------------------\r
# Constants\r
# ---------------------------------------------------------------------------\r
\r
PORTS = {'A': port.A, 'B': port.B, 'C': port.C,\r
         'D': port.D, 'E': port.E, 'F': port.F}\r
\r
# Status LED color name \u2192 color constant (SSP enum values)\r
_LED_COLORS = {\r
    'black': color.BLACK if hasattr(color, 'BLACK') else 0,\r
    'magenta': color.MAGENTA if hasattr(color, 'MAGENTA') else 1,\r
    'violet': color.VIOLET if hasattr(color, 'VIOLET') else 2,\r
    'blue': color.BLUE if hasattr(color, 'BLUE') else 3,\r
    'azure': color.AZURE if hasattr(color, 'AZURE') else 4,\r
    'cyan': color.CYAN if hasattr(color, 'CYAN') else 5,\r
    'green': color.GREEN if hasattr(color, 'GREEN') else 6,\r
    'yellow': color.YELLOW if hasattr(color, 'YELLOW') else 7,\r
    'orange': color.ORANGE if hasattr(color, 'ORANGE') else 8,\r
    'red': color.RED if hasattr(color, 'RED') else 9,\r
    'white': color.WHITE if hasattr(color, 'WHITE') else 10,\r
    'off': 0,\r
}\r
\r
# Image name \u2192 light_matrix constant\r
_IMG_CONST = {\r
    'HEART': 'IMAGE_HEART', 'HEARTSMALL': 'IMAGE_HEART_SMALL',\r
    'HAPPY': 'IMAGE_HAPPY', 'SMILE': 'IMAGE_SMILE', 'SAD': 'IMAGE_SAD',\r
    'CONFUSED': 'IMAGE_CONFUSED', 'ANGRY': 'IMAGE_ANGRY',\r
    'ASLEEP': 'IMAGE_ASLEEP', 'SURPRISED': 'IMAGE_SURPRISED',\r
    'YES': 'IMAGE_YES', 'NO': 'IMAGE_NO',\r
    'ARROWNORTH': 'IMAGE_ARROW_N', 'ARROWEAST': 'IMAGE_ARROW_E',\r
    'ARROWSOUTH': 'IMAGE_ARROW_S', 'ARROWWEST': 'IMAGE_ARROW_W',\r
}\r
_IMAGES_IDX = {\r
    'HEART': 0, 'HEARTSMALL': 1, 'HAPPY': 2, 'SMILE': 3, 'SAD': 4,\r
    'CONFUSED': 5, 'ANGRY': 6, 'ASLEEP': 7, 'SURPRISED': 8,\r
    'YES': 12, 'NO': 13, 'ARROWNORTH': 16, 'ARROWEAST': 18,\r
    'ARROWSOUTH': 20, 'ARROWWEST': 22,\r
}\r
\r
# ---------------------------------------------------------------------------\r
# State\r
# ---------------------------------------------------------------------------\r
\r
_timer_start = time.ticks_ms()\r
_mov_lp = None          # cached motor_pair left port (skip re-pair when same)\r
_mov_rp = None\r
# Orientation frame \u2014 body axes for each hub mounting face.\r
# Body frame (confirmed Top mode): +X=Left(A/C/E), +Y=Front(USB), +Z=Top(display)\r
# Per face: u=up, f=forward, l=left unit vectors in body frame.\r
# Pitch/roll derived from gravity vector; yaw from gyro integration about u-axis.\r
# Convention: pitch+ = ref face tilts forward; roll+ = left(A/C/E) side tilts up; yaw+ = CW.\r
_ORIENT_FRAMES = {\r
    # Vectors in SENSOR coordinates: acc[0]=USB, acc[1]=A/C/E, acc[2]=Top\r
    # (ux,uy,uz, fx,fy,fz, lx,ly,lz) where pitch=atan2(af,au), roll=atan2(al,au)\r
    # pitch+ = reference face tilts forward; roll+ = A/C/E side tilts up; yaw+ = CW\r
    'Top':        ( 0, 0, 1,   1, 0, 0,   0, 1, 0),\r
    'Bottom':     ( 0, 0,-1,   1, 0, 0,   0,-1, 0),\r
    'Front':      ( 1, 0, 0,   0, 0,-1,   0, 1, 0),\r
    'Back':       (-1, 0, 0,   0, 0, 1,   0, 1, 0),\r
    'Left side':  ( 0, 1, 0,   1, 0, 0,   0, 0,-1),\r
    'Right side': ( 0,-1, 0,   1, 0, 0,   0, 0, 1),\r
}\r
_orient_u = (0, 0, 1)   # current up unit vector (sensor frame)\r
_orient_f = (1, 0, 0)   # current forward unit vector (acc[0]=USB for pitch)\r
_orient_l = (0, 1, 0)   # current left unit vector (acc[1]=A/C/E for roll)\r
_yaw_acc  = 0.0         # current heading in degrees\r
_yaw_zero = 0.0         # yaw zero offset in degrees (ResetHubYaw/SetHubYaw)\r
# Complementary filter state for pitch/roll.\r
# Combines gyro (short-term, fast) with accelerometer (long-term, drift-free).\r
# FALLBACK to pure accelerometer: set _CF_ALPHA = 0.0 (pure accel EMA with _CF_ALPHA as weight).\r
_cf_pitch   = 0.0       # complementary-filter pitch (degrees)\r
_cf_roll    = 0.0       # complementary-filter roll (degrees)\r
_cf_last_ms = 0         # timestamp of last orientation update tick\r
_CF_ALPHA   = 0.98      # gyro weight (1-_CF_ALPHA=0.02 is accel correction weight)\r
\r
# Map Python API orientation strings to LEGO face names for HubFaceOrientationRead/Changed.\r
_FACE_NAME_MAP = {\r
    'face_up':    'Top',\r
    'face_down':  'Bottom',\r
    'port_a_up':  'Left side',    # Port A on left face; pitch axis\r
    'port_a_down': 'Right side',\r
    'port_e_up':  'Front',        # Port E end; roll axis\r
    'port_e_down': 'Back',\r
}\r
\r
# Gesture integer \u2192 SSP string name (SPIKE Prime 3.x constants)\r
_GESTURE_MAP = {0: 'tap', 1: 'double_tap', 2: 'shake', 3: 'fall'}\r
# Button constants for hub.button.pressed() API (SPIKE Prime 3.x)\r
_BTN_CONST = {\r
    'left':  hub.button.LEFT  if hasattr(hub.button, 'LEFT')  else 1,\r
    'right': hub.button.RIGHT if hasattr(hub.button, 'RIGHT') else 2,\r
}\r
# Gesture fast-poll: polls gesture() every 10 ms for this many ticks.\r
# 5 ticks = 50 ms (tap reliable); 20 ticks = 200 ms (shake/double_tap reliable).\r
_GESTURE_POLL_TICKS = 20\r
\r
# Subscriptions: port_id -> {type, mode, interval_ms, min_change, last_ms, last_val}\r
_subscriptions = {}\r
_sys_subscriptions = {}  # metric -> {interval_ms, last_ms, last_val}\r
\r
_last_ping_ms = None     # None = heartbeat not yet started\r
_heartbeat_active = False\r
\r
# v0.8: cached volume (student-facing 0-100) for sound.read\r
_cached_volume = 50\r
\r
def _hw_volume():\r
    # Hub speaker is inaudible below ~67. Remap student 1-100 -> hub 67-100\r
    # so the whole dial is usable. 0 stays truly off.\r
    if _cached_volume <= 0:\r
        return 0\r
    return 67 + (_cached_volume - 1) * 33 // 99\r
\r
# v0.8: cached motor acceleration rates (port_id -> ms)\r
_motor_acceleration = {}\r
_movement_acceleration = None\r
\r
# Light matrix display state \u2014 enables software brightness scaling and rotation.\r
# _matrix_pixels[row][col], values 0-100 natural brightness (before scale).\r
_matrix_pixels = [[0] * 5 for _ in range(5)]\r
_matrix_brightness = 100   # global scale 0-100\r
_matrix_orientation = 0    # degrees CW: 0, 90, 180, 270\r
\r
# Known 5x5 pixel patterns for predefined images (row-major, 0=off, 100=on).\r
_IMAGE_PIXELS = {\r
    'HEART':      [[0,100,0,100,0],[100,100,100,100,100],[100,100,100,100,100],[0,100,100,100,0],[0,0,100,0,0]],\r
    'HEARTSMALL': [[0,0,0,0,0],[0,100,0,100,0],[0,100,100,100,0],[0,0,100,0,0],[0,0,0,0,0]],\r
    'HAPPY':      [[0,0,0,0,0],[0,100,0,100,0],[0,0,0,0,0],[100,0,0,0,100],[0,100,100,100,0]],\r
    'SMILE':      [[0,0,0,0,0],[0,0,0,0,0],[0,100,0,100,0],[100,0,0,0,100],[0,100,100,100,0]],\r
    'SAD':        [[0,0,0,0,0],[0,100,0,100,0],[0,0,0,0,0],[0,100,100,100,0],[100,0,0,0,100]],\r
    'CONFUSED':   [[0,0,0,0,0],[0,100,0,100,0],[0,0,0,0,0],[0,0,100,0,0],[0,100,0,0,0]],\r
    'ANGRY':      [[100,0,0,0,100],[0,100,0,100,0],[0,0,0,0,0],[0,100,100,100,0],[100,0,100,0,100]],\r
    'ASLEEP':     [[0,0,0,0,0],[100,100,0,100,100],[0,0,0,0,0],[0,100,100,100,0],[0,0,0,0,0]],\r
    'SURPRISED':  [[0,100,0,100,0],[0,0,0,0,0],[0,0,100,0,0],[0,100,0,100,0],[0,0,100,0,0]],\r
    'YES':        [[0,0,0,0,0],[0,0,0,0,100],[0,0,0,100,0],[100,0,100,0,0],[0,100,0,0,0]],\r
    'NO':         [[100,0,0,0,100],[0,100,0,100,0],[0,0,100,0,0],[0,100,0,100,0],[100,0,0,0,100]],\r
    'ARROWNORTH': [[0,0,100,0,0],[0,100,100,100,0],[100,0,100,0,100],[0,0,100,0,0],[0,0,100,0,0]],\r
    'ARROWEAST':  [[0,0,100,0,0],[0,0,0,100,0],[100,100,100,100,100],[0,0,0,100,0],[0,0,100,0,0]],\r
    'ARROWSOUTH': [[0,0,100,0,0],[0,0,100,0,0],[100,0,100,0,100],[0,100,100,100,0],[0,0,100,0,0]],\r
    'ARROWWEST':  [[0,0,100,0,0],[0,100,0,0,0],[100,100,100,100,100],[0,100,0,0,0],[0,0,100,0,0]],\r
}\r
\r
\r
def _render_matrix():\r
    """Redraw all 25 pixels applying brightness scale and orientation transform."""\r
    for row in range(5):\r
        for col in range(5):\r
            o = _matrix_orientation\r
            if o == 90:\r
                px, py = 4 - row, col\r
            elif o == 180:\r
                px, py = 4 - col, 4 - row\r
            elif o == 270:\r
                px, py = row, 4 - col\r
            else:\r
                px, py = col, row\r
            scaled = int(_matrix_pixels[row][col] * _matrix_brightness / 100)\r
            light_matrix.set_pixel(px, py, scaled)\r
\r
# ---------------------------------------------------------------------------\r
# Tunnel setup\r
# ---------------------------------------------------------------------------\r
\r
tunnel = hub.config['module_tunnel']\r
\r
\r
# ---------------------------------------------------------------------------\r
# Helpers\r
# ---------------------------------------------------------------------------\r
\r
def _send(obj):\r
    """Send a JSON event to the client."""\r
    try:\r
        tunnel.send((json.dumps(obj) + '\\n').encode())\r
    except Exception:\r
        pass\r
\r
\r
def _send_error(code, message, request_id=None):\r
    err = {'event': 'error', 'code': code, 'message': message}\r
    if request_id is not None:\r
        err['request_id'] = request_id\r
    _send(err)\r
\r
\r
def _sensor_event(port_id, sensor_type, value, request_id=None):\r
    ev = {'event': 'sensor', 'port': port_id, 'type': sensor_type, 'value': value}\r
    if request_id is not None:\r
        ev['request_id'] = request_id\r
    _send(ev)\r
\r
\r
def _system_event(metric, value):\r
    _send({'event': 'system', 'metric': metric, 'value': value})\r
\r
\r
def _dot(a, b):\r
    return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]\r
\r
\r
def _update_orientation(now):\r
    """Update pitch/roll (complementary filter) and yaw (hardware or gyro).\r
\r
    Complementary filter blends gyro short-term precision with accelerometer\r
    long-term correction: angle = CF_ALPHA*(angle + rate*dt) + (1-CF_ALPHA)*accel_angle.\r
    FALLBACK: set _CF_ALPHA=0.0 to revert to pure accelerometer (accel_angle only).\r
\r
    Yaw strategy: Top/Bottom use drift-free hardware-fused yaw from tilt_angles()[0].\r
    Other faces use gyro integration with a 1.5 deg/s stillness guard to limit tilt bleed.\r
    """\r
    global _cf_pitch, _cf_roll, _cf_last_ms, _yaw_acc\r
    try:\r
        # --- Shared sensor reads ---\r
        a = hub.motion_sensor.acceleration()   # mg, sensor frame\r
        ax, ay, az = a[0], a[1], a[2]\r
        w = hub.motion_sensor.angular_velocity()  # decideg/s, sensor frame\r
        wx, wy, wz = w[0] / 10.0, w[1] / 10.0, w[2] / 10.0\r
\r
        # --- Pitch / Roll: complementary filter ---\r
        au = _dot(_orient_u, (ax, ay, az))\r
        accel_pitch = math.degrees(math.atan2(_dot(_orient_f, (ax, ay, az)), au))\r
        accel_roll  = math.degrees(math.atan2(_dot(_orient_l, (ax, ay, az)), au))\r
\r
        dt_ms = time.ticks_diff(now, _cf_last_ms) if _cf_last_ms else 0\r
        _cf_last_ms = now\r
\r
        if 0 < dt_ms <= 500 and _CF_ALPHA > 0.0:\r
            dt_s = dt_ms / 1000.0\r
            # Pitch: negate because rotating l toward u (pitch+) is -rotation about l.\r
            # Roll: positive because rotating l toward u about f-axis is +rotation about f.\r
            pitch_rate = -_dot(_orient_l, (wx, wy, wz))\r
            roll_rate  =  _dot(_orient_f, (wx, wy, wz))\r
            _cf_pitch = _CF_ALPHA * (_cf_pitch + pitch_rate * dt_s) + (1.0 - _CF_ALPHA) * accel_pitch\r
            _cf_roll  = _CF_ALPHA * (_cf_roll  + roll_rate  * dt_s) + (1.0 - _CF_ALPHA) * accel_roll\r
        else:\r
            # First tick, long gap, or CF_ALPHA=0 fallback: use pure accel.\r
            _cf_pitch = accel_pitch\r
            _cf_roll  = accel_roll\r
\r
        # --- Yaw ---\r
        if abs(_orient_u[2]) > 0.5:\r
            # Top / Bottom: drift-free hardware-fused yaw. CW from above = positive.\r
            raw = hub.motion_sensor.tilt_angles()\r
            _yaw_acc = -raw[0] / 10.0\r
        else:\r
            # Side / end mounting: gyro integration with stillness guard.\r
            if 0 < dt_ms <= 500:\r
                rate = -_dot(_orient_u, (wx, wy, wz))\r
                if abs(rate) > 1.5:\r
                    _yaw_acc += rate * (dt_ms / 1000.0)\r
    except Exception:\r
        pass\r
\r
\r
def _tilt_angles():\r
    """Returns (pitch, roll, yaw) in integer degrees for the current orientation."""\r
    return (int(round(_cf_pitch)),\r
            int(round(_cf_roll)),\r
            int(round(_yaw_acc - _yaw_zero)))\r
\r
\r
def _ensure_pair(lp, rp):\r
    """Re-pair motor pair only when ports change. Unpair first so a new pair\r
    can replace an existing one; only cache the ports if pairing succeeds."""\r
    global _mov_lp, _mov_rp\r
    if lp != _mov_lp or rp != _mov_rp:\r
        try:\r
            try:\r
                motor_pair.unpair(motor_pair.PAIR_1)\r
            except Exception:\r
                pass\r
            motor_pair.pair(motor_pair.PAIR_1, PORTS[lp], PORTS[rp])\r
            _mov_lp, _mov_rp = lp, rp  # only cache on successful pair\r
        except Exception:\r
            _mov_lp, _mov_rp = None, None  # force retry next time\r
\r
\r
def _show_image(name):\r
    global _matrix_pixels\r
    n = name.upper()\r
    if n in _IMAGE_PIXELS:\r
        # Use our pixel map \u2014 supports brightness scaling and rotation.\r
        _matrix_pixels = [row[:] for row in _IMAGE_PIXELS[n]]\r
        _render_matrix()\r
        return\r
    # Fallback: let firmware render (brightness/rotation won't apply).\r
    const = _IMG_CONST.get(n)\r
    if const is not None:\r
        try:\r
            img = getattr(light_matrix, const)\r
            light_matrix.show_image(img)\r
            return\r
        except AttributeError:\r
            pass\r
    idx = _IMAGES_IDX.get(n, 2)\r
    light_matrix.show_image(idx)\r
\r
\r
def _face_orientation():\r
    """Return LEGO face name (Top/Bottom/Front/Back/Left side/Right side) from IMU."""\r
    try:\r
        try:\r
            raw = hub.motion_sensor.get_orientation()\r
            return _FACE_NAME_MAP.get(raw, raw)  # map Python API string to LEGO name\r
        except AttributeError:\r
            pass\r
        # Fallback: detect face from gravity vector (sensor frame: acc[0]=USB, acc[1]=ACE, acc[2]=Top).\r
        try:\r
            a = hub.motion_sensor.acceleration()\r
            ax, ay, az = abs(a[0]), abs(a[1]), abs(a[2])\r
            if az >= ax and az >= ay:\r
                return 'Top' if a[2] > 0 else 'Bottom'\r
            elif ax >= ay:\r
                return 'Front' if a[0] > 0 else 'Back'\r
            else:\r
                return 'Left side' if a[1] > 0 else 'Right side'\r
        except Exception:\r
            return 'Top'\r
    except Exception:\r
        return 'Top'\r
\r
\r
def _angular_velocity():\r
    """Return angular velocity {x, y, z} in deg/s. Hub returns decideg/s \u2014 divide by 10."""\r
    try:\r
        av = hub.motion_sensor.angular_velocity()\r
        return {'x': av[0] / 10.0, 'y': av[1] / 10.0, 'z': av[2] / 10.0}\r
    except Exception:\r
        return {'x': 0, 'y': 0, 'z': 0}\r
\r
\r
def _read_sensor_value(port_id, sensor_type, params=None):\r
    """Reads a sensor value. Returns None on error."""\r
    # IMU-specific types routed directly\r
    if port_id == 'imu' or sensor_type in ('pitch', 'roll', 'yaw',\r
                                             'face_orientation', 'angular_velocity',\r
                                             'acceleration', 'gesture', 'is_tilted'):\r
        try:\r
            if sensor_type == 'pitch':          return _tilt_angles()[0]\r
            if sensor_type == 'roll':           return _tilt_angles()[1]\r
            if sensor_type == 'yaw':            return _tilt_angles()[2]\r
            if sensor_type == 'face_orientation': return _face_orientation()\r
            if sensor_type == 'angular_velocity': return _angular_velocity()\r
            if sensor_type == 'gesture':\r
                try:\r
                    return _GESTURE_MAP.get(hub.motion_sensor.gesture(), None)\r
                except Exception:\r
                    return None\r
            if sensor_type == 'acceleration':\r
                try:\r
                    acc = hub.motion_sensor.acceleration()\r
                    return {'x': round(acc[0] / 100.0, 2),\r
                            'y': round(acc[1] / 100.0, 2),\r
                            'z': round(acc[2] / 100.0, 2)}\r
                except Exception:\r
                    return {'x': 0, 'y': 0, 'z': 0}\r
            if sensor_type == 'is_orientation':\r
                p2 = params or {}\r
                queried = p2.get('face', '').lower()\r
                cur = _face_orientation().lower()\r
                return {'match': cur == queried, 'face': p2.get('face', '')}\r
            if sensor_type == 'is_shaking':\r
                try:\r
                    return _GESTURE_MAP.get(hub.motion_sensor.gesture()) == 'shake'\r
                except Exception:\r
                    return False\r
            if sensor_type == 'is_tilted':\r
                p2 = params or {}\r
                direction = p2.get('direction', 'any').lower()\r
                pitch, roll, _ = _tilt_angles()\r
                THRESHOLD = 20\r
                if direction == 'forward':    result = pitch < -THRESHOLD\r
                elif direction == 'backward': result = pitch > THRESHOLD\r
                elif direction == 'left':     result = roll < -THRESHOLD  # A/C/E side down = roll negative\r
                elif direction == 'right':    result = roll > THRESHOLD   # B/D/F side down = roll positive\r
                else:                         result = abs(pitch) > THRESHOLD or abs(roll) > THRESHOLD\r
                return {'tilted': result, 'direction': direction}\r
        except Exception:\r
            return None\r
\r
    p = PORTS.get(port_id.upper())\r
    if p is None:\r
        return None\r
\r
    # Motor position / speed reading \u2014 try multiple FW 3.x function names\r
    if sensor_type == 'position':\r
        # Cumulative position since last reset (can exceed 360 or be negative)\r
        for fn_name in ('relative_position', 'get_position'):\r
            fn = getattr(motor, fn_name, None)\r
            if fn is not None:\r
                try:\r
                    return fn(p)\r
                except Exception:\r
                    continue\r
        return None\r
    if sensor_type == 'absolute_position':\r
        # Current orientation 0-359\r
        fn = getattr(motor, 'absolute_position', None)\r
        if fn is not None:\r
            try:\r
                return fn(p)\r
            except Exception:\r
                return None\r
        # Fallback: cumulative position mod 360\r
        for fn_name in ('relative_position', 'get_position'):\r
            fn = getattr(motor, fn_name, None)\r
            if fn is not None:\r
                try:\r
                    return fn(p) % 360\r
                except Exception:\r
                    continue\r
        return None\r
    if sensor_type == 'speed':\r
        # On observed SPIKE Prime 3.x firmware, motor.velocity(port) returns the\r
        # current speed already in PERCENT (-100..100), not deg/s as the docs claim.\r
        # At 100% speed setting it reads ~88 due to closed-loop tracking.\r
        fn = getattr(motor, 'velocity', None) or getattr(motor, 'get_velocity', None)\r
        if fn is not None:\r
            try:\r
                return int(fn(p))\r
            except Exception:\r
                pass\r
        return None\r
\r
    if not _sensors_ok:\r
        return None\r
    try:\r
        if sensor_type == 'color':\r
            c = color_sensor.color(p)\r
            return _CLR_MAP.get(c, str(c))\r
        elif sensor_type == 'rgb':\r
            try:\r
                rgb = color_sensor.rgbi(p)  # (r, g, b, intensity) \u2014 raw 0-1023 range\r
                intensity = rgb[3] if rgb[3] > 0 else 1\r
                # Normalize to 0-255 using intensity as the scale reference.\r
                return [min(255, int(rgb[i] * 255 // intensity)) for i in range(3)]\r
            except Exception:\r
                return [0, 0, 0]\r
        elif sensor_type == 'reflected':\r
            return color_sensor.reflection(p)\r
        elif sensor_type == 'ambient':\r
            return color_sensor.ambient_light(p)\r
        elif sensor_type == 'distance':\r
            return distance_sensor.distance(p)\r
        elif sensor_type == 'force':\r
            return force_sensor.force(p)\r
        elif sensor_type == 'touched':\r
            return force_sensor.pressed(p)\r
        elif sensor_type == 'is_color':\r
            p2 = params or {}\r
            c = color_sensor.color(p)\r
            name = _CLR_MAP.get(c, str(c)).lower()\r
            queried = p2.get('color', '').lower()\r
            return {'match': name == queried, 'color': queried}\r
        elif sensor_type == 'is_closer':\r
            p2 = params or {}\r
            d = distance_sensor.distance(p)\r
            mm = int(p2.get('mm', 0))\r
            return isinstance(d, (int, float)) and 0 <= d <= mm\r
        elif sensor_type == 'is_reflected_above':\r
            p2 = params or {}\r
            r = color_sensor.reflection(p)\r
            return isinstance(r, (int, float)) and r > int(p2.get('percent', 0))\r
    except Exception:\r
        return None\r
\r
\r
def _read_system_metric(metric):\r
    """Reads a system metric value. Returns None on error."""\r
    try:\r
        if metric == 'battery':\r
            # hub.battery_voltage may be a callable or direct attribute.\r
            # Normalise to 0-100 assuming ~6400-8400 mV range (2-cell Li-ion).\r
            try:\r
                v = hub.battery_voltage() if callable(hub.battery_voltage) else hub.battery_voltage\r
                return max(0, min(100, (v - 6400) * 100 // 2000))\r
            except Exception:\r
                return None\r
        elif metric == 'temperature':\r
            try:\r
                return hub.temperature() / 10.0  # hub returns decidegrees\r
            except Exception:\r
                try:\r
                    return hub.battery_temperature / 10.0\r
                except Exception:\r
                    return None\r
        elif metric == 'charging':\r
            # usb_charge_current: ~0-3 unplugged, ~190+ when charging (measured).\r
            try:\r
                uc = hub.usb_charge_current() if callable(hub.usb_charge_current) else hub.usb_charge_current\r
                return uc > 20\r
            except Exception:\r
                return False\r
        elif metric == 'connection_rssi':\r
            return None  # measured on Android side, not accessible from Python\r
    except Exception:\r
        return None\r
    return None\r
\r
\r
# ---------------------------------------------------------------------------\r
# Capability declaration\r
# ---------------------------------------------------------------------------\r
\r
def _build_capability():\r
    ports_list = []\r
\r
    # Motor ports: try each port; include as motor if present\r
    for pid in ('A', 'B', 'C', 'D', 'E', 'F'):\r
        try:\r
            p = PORTS[pid]\r
            # probe: if port.device is None, nothing connected\r
            device = getattr(p, 'device', None)\r
            if device is None:\r
                continue\r
            ports_list.append({\r
                'id': pid,\r
                'type': 'motor',\r
                'features': ['speed', 'position', 'stall', 'power', 'acceleration'],\r
                'goto_modes': ['absolute', 'relative'],\r
                'constraints': {\r
                    'speed':        {'type': 'int', 'min': -100, 'max': 100},\r
                    'position':     {'type': 'int', 'min': 0, 'max': 359, 'wraps': True},\r
                    'acceleration': {'type': 'int', 'min': 0, 'max': 10000},\r
                },\r
            })\r
        except Exception:\r
            pass\r
\r
    # Display port (always present)\r
    ports_list.append({\r
        'id': 'display',\r
        'type': 'display',\r
        'width': 5, 'height': 5, 'depth': 'grayscale',\r
        'features': ['pixel', 'image', 'text', 'brightness', 'orientation'],\r
        # 'touch' feature omitted until FW support is verified\r
    })\r
\r
    # Status LED (always present)\r
    ports_list.append({\r
        'id': 'status',\r
        'type': 'led',\r
        'features': ['set'],\r
        'constraints': {\r
            'color': {'type': 'enum', 'values': list(_LED_COLORS.keys())},\r
        },\r
    })\r
\r
    # IMU (always present on SPIKE Prime 3.x) \u2014 v0.7/v0.8 features\r
    ports_list.append({\r
        'id': 'imu',\r
        'type': 'orientation',\r
        'features': ['pitch', 'roll', 'yaw', 'gesture', 'face_orientation', 'angular_velocity'],\r
        'constraints': {\r
            'gesture': {\r
                'type': 'enum',\r
                'values': ['shake', 'tap', 'double_tap', 'fall'],\r
            },\r
            'face_orientation': {\r
                'type': 'enum',\r
                'values': ['face_up', 'face_down', 'port_a_up', 'port_a_down',\r
                           'port_e_up', 'port_e_down'],\r
            },\r
        },\r
    })\r
\r
    # Speaker \u2014 v0.8: volume + sound_wait_supported\r
    ports_list.append({\r
        'id': 'speaker',\r
        'type': 'speaker',\r
        'features': ['beep', 'volume'],\r
        'sound_wait_supported': True,\r
        # 'builtin' and 'midi' features added after FW API verification\r
    })\r
\r
    return {\r
        'type': 'capability',\r
        'device': 'spike-prime',\r
        'firmware': '3.x',\r
        'ssp_version': '0.8',\r
        'encodings': ['json-utf8-newline'],\r
        'supports_batch': False,\r
        'tank_drive': True,\r
        'system_metrics': [\r
            'battery', 'charging', 'temperature',\r
            'button.left', 'button.right', 'button.center',\r
        ],\r
        'ports': ports_list,\r
    }\r
\r
\r
# ---------------------------------------------------------------------------\r
# Command handlers\r
# ---------------------------------------------------------------------------\r
\r
def _handle_motor(cmd, obj, req_id):\r
    action = cmd.split('.')[1]  # run, stop, goto, reset, set_acceleration\r
    port_id = obj.get('port', '').upper()\r
\r
    # set_acceleration doesn't need a physical port\r
    if action == 'set_acceleration':\r
        rate = int(obj.get('rate', 500))\r
        _motor_acceleration[port_id] = rate\r
        # SPIKE FW may not expose hardware-level accel; cache client-side for now\r
        return\r
\r
    p = PORTS.get(port_id)\r
    if p is None:\r
        _send_error(201, 'Unknown port: ' + port_id, req_id)\r
        return\r
\r
    try:\r
        if action == 'run':\r
            raw_speed = int(obj.get('speed', 0))\r
            mode = obj.get('mode', 'speed')\r
\r
            # Power mode: open-loop raw duty cycle, no velocity feedback.\r
            # SPIKE FW 3.x exposes this differently across versions \u2014 try known APIs.\r
            if mode == 'power':\r
                # raw_speed is -100..+100 percent duty cycle\r
                power_pct = max(-100, min(100, raw_speed))\r
                attempts = [\r
                    lambda: motor.start_at_power(p, power_pct),\r
                    lambda: motor.run(p, power_pct, mode=getattr(motor, 'POWER', 1)),\r
                    # Last resort: scale to velocity range (approximate)\r
                    lambda: motor.run(p, power_pct * 11),\r
                ]\r
                for attempt in attempts:\r
                    try:\r
                        attempt()\r
                        break\r
                    except (AttributeError, TypeError):\r
                        continue\r
                    except Exception as e:\r
                        _send_error(301, 'motor.run power: ' + str(e), req_id)\r
                        break\r
                return\r
\r
            spd = raw_speed * 11\r
            dur = obj.get('duration')\r
            unit = obj.get('duration_unit', 'ms')\r
            # Apply cached acceleration for timed runs (SPIKE FW supports kwarg)\r
            accel = _motor_acceleration.get(port_id.upper(), None)\r
            if dur is not None:\r
                dur = int(dur)\r
                accel_kwargs = {'acceleration': accel, 'deceleration': accel} if accel else {}\r
                try:\r
                    if unit == 'ms':\r
                        motor.run_for_time(p, dur, spd, **accel_kwargs)\r
                    elif unit == 'degrees':\r
                        motor.run_for_degrees(p, dur, spd, **accel_kwargs)\r
                    elif unit == 'rotations':\r
                        motor.run_for_degrees(p, dur * 360, spd, **accel_kwargs)\r
                except TypeError:\r
                    # FW version doesn't support acceleration kwargs \u2014 run without\r
                    if unit == 'ms':\r
                        motor.run_for_time(p, dur, spd)\r
                    elif unit == 'degrees':\r
                        motor.run_for_degrees(p, dur, spd)\r
                    elif unit == 'rotations':\r
                        motor.run_for_degrees(p, dur * 360, spd)\r
            else:\r
                # Indefinite run \u2014 try acceleration kwarg first (newer FW), fall back\r
                if accel:\r
                    try:\r
                        motor.run(p, spd, acceleration=accel)\r
                    except TypeError:\r
                        motor.run(p, spd)\r
                else:\r
                    motor.run(p, spd)\r
\r
        elif action == 'stop':\r
            stop_action = obj.get('stop_action', 'brake')\r
            # Map our string to the FW constant if available\r
            stop_const = None\r
            if stop_action == 'coast':\r
                stop_const = getattr(motor, 'COAST', None)\r
            elif stop_action == 'hold':\r
                stop_const = getattr(motor, 'HOLD', None)\r
            elif stop_action == 'brake':\r
                stop_const = getattr(motor, 'BRAKE', None) or getattr(motor, 'SMART_BRAKING', None)\r
            # Try with kwarg, then positional, then plain stop\r
            if stop_const is not None:\r
                try:\r
                    motor.stop(p, stop=stop_const)\r
                except TypeError:\r
                    try:\r
                        motor.stop(p, stop_const)\r
                    except TypeError:\r
                        motor.stop(p)\r
            else:\r
                motor.stop(p)\r
\r
        elif action == 'goto':\r
            pos = int(obj.get('position', 0))\r
            spd = abs(int(obj.get('speed', 50))) * 11\r
            goto_mode = obj.get('mode', 'absolute')\r
            if goto_mode == 'relative':\r
                motor.run_for_degrees(p, pos, spd)\r
            else:\r
                # Absolute goto via delta-of-run_for_degrees workaround.\r
                # SPIKE FW 3.x absolute-position APIs vary too much across versions\r
                # (run_to_position vs run_to_absolute_position with different signatures),\r
                # but motor.run_for_degrees is reliably present. We compute the shortest\r
                # delta from current absolute position to the target and run that.\r
                target = pos % 360\r
                current = None\r
                # Try canonical FW 3.x function names for current position\r
                for fn_name in ('absolute_position', 'relative_position'):\r
                    fn = getattr(motor, fn_name, None)\r
                    if fn is not None:\r
                        try:\r
                            current = fn(p) % 360\r
                            break\r
                        except Exception:\r
                            pass\r
                if current is None:\r
                    _send_error(301, 'goto: cannot read current motor position', req_id)\r
                else:\r
                    delta = target - current\r
                    if delta > 180:   delta -= 360\r
                    elif delta < -180: delta += 360\r
                    try:\r
                        motor.run_for_degrees(p, delta, spd)\r
                    except Exception as e:\r
                        _send_error(301, 'goto failed: %s: %s' %\r
                                    (type(e).__name__, str(e)), req_id)\r
\r
        elif action == 'reset':\r
            motor.reset_relative_position(p, 0)\r
\r
    except Exception as e:\r
        _send_error(301, 'Motor error: ' + str(e), req_id)\r
\r
\r
def _handle_movement(cmd, obj, req_id):\r
    global _movement_acceleration\r
    action = cmd.split('.')[1]  # configure, drive, turn, stop, set_acceleration\r
\r
    try:\r
        if action == 'set_acceleration':\r
            _movement_acceleration = int(obj.get('rate', 500))\r
            return\r
\r
        if action == 'configure':\r
            lp = obj.get('left', '').upper()\r
            rp = obj.get('right', '').upper()\r
            if lp in PORTS and rp in PORTS:\r
                _ensure_pair(lp, rp)\r
\r
        elif action == 'drive':\r
            lp = obj.get('left', _mov_lp or 'A').upper()\r
            rp = obj.get('right', _mov_rp or 'B').upper()\r
            if lp in PORTS and rp in PORTS:\r
                _ensure_pair(lp, rp)\r
\r
            # v0.7 tank drive: explicit left_speed / right_speed\r
            accel = _movement_acceleration\r
            accel_kw = {'acceleration': accel, 'deceleration': accel} if accel is not None else {}\r
            if 'left_speed' in obj or 'right_speed' in obj:\r
                l_vel = int(obj.get('left_speed', 0)) * 11\r
                r_vel = int(obj.get('right_speed', 0)) * 11\r
                try:\r
                    motor_pair.move_tank(motor_pair.PAIR_1, l_vel, r_vel, **accel_kw)\r
                except TypeError:\r
                    motor_pair.move_tank(motor_pair.PAIR_1, l_vel, r_vel)\r
            else:\r
                steering = int(obj.get('steering', 0))\r
                vel = int(obj.get('speed', 50)) * 11\r
                dur = obj.get('duration')\r
                unit = obj.get('duration_unit', 'ms')\r
                if dur is not None:\r
                    dur = int(dur)\r
                    try:\r
                        if unit == 'degrees':\r
                            motor_pair.move_for_degrees(motor_pair.PAIR_1, dur, steering, velocity=vel, **accel_kw)\r
                        elif unit == 'rotations':\r
                            motor_pair.move_for_degrees(motor_pair.PAIR_1, dur * 360, steering, velocity=vel, **accel_kw)\r
                        else:\r
                            motor_pair.move_for_time(motor_pair.PAIR_1, dur, steering, velocity=vel, **accel_kw)\r
                    except TypeError:\r
                        if unit == 'degrees':\r
                            motor_pair.move_for_degrees(motor_pair.PAIR_1, dur, steering, velocity=vel)\r
                        elif unit == 'rotations':\r
                            motor_pair.move_for_degrees(motor_pair.PAIR_1, dur * 360, steering, velocity=vel)\r
                        else:\r
                            motor_pair.move_for_time(motor_pair.PAIR_1, dur, steering, velocity=vel)\r
                else:\r
                    try:\r
                        motor_pair.move(motor_pair.PAIR_1, steering, velocity=vel, **accel_kw)\r
                    except TypeError:\r
                        motor_pair.move(motor_pair.PAIR_1, steering, velocity=vel)\r
\r
        elif action == 'turn':\r
            angle = int(obj.get('angle', 90))\r
            vel = int(obj.get('speed', 50)) * 11\r
            accel = _movement_acceleration\r
            accel_kw = {'acceleration': accel, 'deceleration': accel} if accel is not None else {}\r
            try:\r
                motor_pair.move_for_degrees(motor_pair.PAIR_1, angle, 0, velocity=vel, **accel_kw)\r
            except TypeError:\r
                motor_pair.move_for_degrees(motor_pair.PAIR_1, angle, 0, velocity=vel)\r
\r
        elif action == 'stop':\r
            stop_action = obj.get('stop_action', 'brake')\r
            stop_const = None\r
            if stop_action == 'coast':\r
                stop_const = getattr(motor_pair, 'COAST', None)\r
            elif stop_action == 'hold':\r
                stop_const = getattr(motor_pair, 'HOLD', None)\r
            elif stop_action == 'brake':\r
                stop_const = getattr(motor_pair, 'BRAKE', None) or getattr(motor_pair, 'SMART_BRAKING', None)\r
            if stop_const is not None:\r
                try:\r
                    motor_pair.stop(motor_pair.PAIR_1, stop=stop_const)\r
                except TypeError:\r
                    try:\r
                        motor_pair.stop(motor_pair.PAIR_1, stop_const)\r
                    except TypeError:\r
                        motor_pair.stop(motor_pair.PAIR_1)\r
            else:\r
                motor_pair.stop(motor_pair.PAIR_1)\r
\r
    except Exception as e:\r
        _send_error(301, 'Movement error: ' + str(e), req_id)\r
\r
\r
def _handle_led(cmd, obj, req_id):\r
    global _matrix_pixels, _matrix_brightness, _matrix_orientation\r
    parts = cmd.split('.')  # ['led', 'set'], ['led', 'distance'], ['led', 'matrix', 'pixel']\r
    if len(parts) == 2 and parts[1] == 'distance':\r
        p = PORTS.get(obj.get('port', '').upper())\r
        if p is not None:\r
            try:\r
                distance_sensor.show(p, [\r
                    int(obj.get('tl', 0)),\r
                    int(obj.get('tr', 0)),\r
                    int(obj.get('bl', 0)),\r
                    int(obj.get('br', 0)),\r
                ])\r
            except Exception as e:\r
                _send_error(301, 'distance LED error: ' + str(e), req_id)\r
        return\r
    if len(parts) == 2:\r
        action = parts[1]  # set, off\r
        port_id = obj.get('port', '')\r
        if port_id == 'status':\r
            if action == 'set':\r
                color_name = str(obj.get('color', 'off')).lower()\r
                c = _LED_COLORS.get(color_name, 0)\r
                try:\r
                    # Two-arg form: target the POWER (center button) light.\r
                    # CONNECT (light 1) is owned by firmware for BLE status.\r
                    hub.light.color(getattr(hub.light, 'POWER', 0), c)\r
                except Exception:\r
                    pass\r
            elif action == 'off':\r
                try:\r
                    hub.light.color(getattr(hub.light, 'POWER', 0), 0)\r
                except Exception:\r
                    pass\r
    elif len(parts) >= 3 and parts[1] == 'matrix':\r
        action = parts[2]  # pixel, image, text, clear, brightness, orientation, rotate\r
        try:\r
            if action == 'pixel':\r
                x = int(obj.get('x', 0))\r
                y = int(obj.get('y', 0))\r
                brightness = int(obj.get('brightness', 100))\r
                _matrix_pixels[y][x] = max(0, min(100, brightness))\r
                scaled = int(_matrix_pixels[y][x] * _matrix_brightness / 100)\r
                light_matrix.set_pixel(x, y, scaled)\r
\r
            elif action == 'image':\r
                _show_image(str(obj.get('image', 'HAPPY')))\r
\r
            elif action == 'text':\r
                text = str(obj.get('text', ''))\r
                light_matrix.write(text)\r
\r
            elif action == 'clear':\r
                _matrix_pixels = [[0] * 5 for _ in range(5)]\r
                _render_matrix()\r
\r
            elif action == 'brightness':\r
                _matrix_brightness = max(0, min(100, int(obj.get('level', 100))))\r
                _render_matrix()\r
\r
            elif action == 'orientation':\r
                _matrix_orientation = int(obj.get('rotation', 0)) % 360\r
                _render_matrix()\r
\r
            elif action == 'rotate':\r
                degrees = int(obj.get('degrees', 90))\r
                _matrix_orientation = (_matrix_orientation + degrees) % 360\r
                _render_matrix()\r
\r
        except Exception as e:\r
            _send_error(301, 'LED error: ' + str(e), req_id)\r
\r
\r
def _handle_sound(cmd, obj, req_id):\r
    global _cached_volume\r
    action = cmd.split('.')[1]  # beep, play, stop, set_volume, read\r
    try:\r
        if action == 'beep':\r
            freq = int(obj.get('freq', 440))\r
            dur = obj.get('duration')\r
            if dur is not None:\r
                hub.sound.beep(freq, int(dur), _hw_volume())\r
                # wait=true means music context (PlayNoteForBeats) \u2014 block until done\r
                # so notes play sequentially. Sound context (Beep) leaves wait=false.\r
                if obj.get('wait', False):\r
                    time.sleep_ms(int(dur))\r
            else:\r
                # Indefinite beep \u2014 no native API; just beep for a long time\r
                hub.sound.beep(freq, 30000, _hw_volume())\r
\r
        elif action == 'rest':\r
            time.sleep_ms(int(obj.get('duration', 0)))\r
\r
        elif action == 'stop':\r
            hub.sound.stop()\r
\r
        elif action == 'play':\r
            wait = obj.get('wait', False)\r
            sound_name = obj.get('sound')\r
            notes = obj.get('notes')\r
            if notes:\r
                # v0.8 MIDI notes \u2014 parse and play via beep sequences (best effort)\r
                _play_notes_sequence(notes, int(obj.get('tempo', 120)), req_id)\r
                return\r
            if sound_name:\r
                if wait:\r
                    try:\r
                        hub.sound.play(str(sound_name), volume=_cached_volume)\r
                        _send({'event': 'sound_complete', 'request_id': req_id} if req_id else\r
                              {'event': 'sound_complete'})\r
                    except TypeError:\r
                        hub.sound.play(str(sound_name))\r
                        _send({'event': 'sound_complete'})\r
                else:\r
                    hub.sound.play(str(sound_name))\r
\r
        elif action == 'set_volume':\r
            # Store only \u2014 volume is applied per-beep via the beep() volume arg.\r
            # Do NOT also call hub.sound.volume() or scaling is applied twice.\r
            level = int(obj.get('level', 50))\r
            _cached_volume = max(0, min(100, level))\r
\r
        elif action == 'read':\r
            metric = obj.get('metric', 'volume')\r
            if metric == 'volume':\r
                _send({'event': 'sound', 'metric': 'volume', 'value': _cached_volume})\r
\r
    except Exception as e:\r
        _send_error(301, 'Sound error: ' + str(e), req_id)\r
\r
\r
def _play_notes_sequence(notes_str, tempo, req_id):\r
    """Parse v0.8 \xA76.3.1 notes string and play as beeps (best-effort MIDI)."""\r
    # Note name -> frequency mapping (A4=440 Hz standard)\r
    NOTE_FREQ = {\r
        'C': 261, 'C#': 277, 'Db': 277, 'D': 293, 'D#': 311, 'Eb': 311,\r
        'E': 329, 'F': 349, 'F#': 369, 'Gb': 369, 'G': 392, 'G#': 415,\r
        'Ab': 415, 'A': 440, 'A#': 466, 'Bb': 466, 'B': 493,\r
    }\r
    ms_per_beat = int(60000 / max(1, tempo))\r
    try:\r
        tokens = notes_str.strip().split()\r
        for token in tokens:\r
            if ':' not in token:\r
                continue\r
            note_part, dur_part = token.rsplit(':', 1)\r
            duration_ms = int(float(dur_part) * ms_per_beat)\r
            if note_part == 'R':\r
                time.sleep_ms(duration_ms)\r
                continue\r
            # Strip octave digit to get note name, then compute freq\r
            import re as _re\r
            m = _re.match(r'([A-G][#b]?)(\\d)', note_part)\r
            if m:\r
                name, octave = m.group(1), int(m.group(2))\r
                base_freq = NOTE_FREQ.get(name, 440)\r
                freq = int(base_freq * (2 ** (octave - 4)))\r
                hub.sound.beep(freq, duration_ms, _hw_volume())\r
            else:\r
                time.sleep_ms(duration_ms)\r
    except Exception:\r
        pass  # degrade silently\r
\r
\r
def _handle_sensor(cmd, obj, req_id):\r
    action = cmd.split('.')[1]  # subscribe, unsubscribe, read\r
    port_id = obj.get('port', '')\r
\r
    if action == 'subscribe':\r
        mode = obj.get('mode', 'interval')\r
        interval_ms = int(obj.get('interval', 100))\r
        min_change = obj.get('min_change', None)\r
        # Determine sensor type from port capabilities (simplistic)\r
        if port_id == 'imu':\r
            sensor_type = obj.get('type', 'pitch')\r
        else:\r
            sensor_type = obj.get('type', 'color')\r
        _subscriptions[port_id] = {\r
            'type': sensor_type,\r
            'mode': mode,\r
            'interval_ms': interval_ms,\r
            'min_change': float(min_change) if min_change is not None else None,\r
            'last_ms': 0,\r
            'last_val': None,\r
        }\r
\r
    elif action == 'unsubscribe':\r
        _subscriptions.pop(port_id, None)\r
\r
    elif action == 'read':\r
        sensor_type = obj.get('type', 'color')\r
        val = _read_sensor_value(port_id, sensor_type, obj)\r
        if val is not None:\r
            _sensor_event(port_id, sensor_type, val, req_id)\r
\r
\r
def _handle_system(cmd, obj, req_id):\r
    global _last_ping_ms, _heartbeat_active\r
    action = cmd.split('.')[1]  # ping, info, subscribe, unsubscribe, read, reset\r
\r
    if action == 'ping':\r
        _last_ping_ms = time.ticks_ms()\r
        _heartbeat_active = True\r
        _send({'event': 'pong'})\r
\r
    elif action == 'info':\r
        _send({\r
            'event': 'system_info',\r
            'device': 'spike-prime',\r
            'ssp_version': '0.8',\r
        })\r
\r
    elif action == 'subscribe':\r
        metric = obj.get('metric', '')\r
        interval_ms = int(obj.get('interval', 5000))\r
        _sys_subscriptions[metric] = {\r
            'interval_ms': interval_ms,\r
            'last_ms': 0,\r
            'last_val': None,\r
        }\r
\r
    elif action == 'unsubscribe':\r
        _sys_subscriptions.pop(obj.get('metric', ''), None)\r
\r
    elif action == 'read':\r
        metric = obj.get('metric', '')\r
        if metric == 'is_button_pressed':\r
            btn = obj.get('button', 'left')\r
            state = _read_button(btn)\r
            _send({'event': 'system', 'metric': 'is_button_pressed',\r
                   'value': {'button': btn, 'pressed': state == 'pressed'}})\r
        elif metric.startswith('button.'):\r
            btn_name = metric.split('.')[1]\r
            try:\r
                state = _read_button(btn_name)\r
                _system_event(metric, state)\r
            except Exception:\r
                pass\r
        else:\r
            val = _read_system_metric(metric)\r
            if val is not None:\r
                _system_event(metric, val)\r
\r
    elif action == 'reset':\r
        pass  # no-op on this platform\r
\r
    elif action == 'dfu':\r
        # SSP v0.8 spec defines system.dfu for firmware update initiation.\r
        # Not supported in this bridge \u2014 respond with a clear error.\r
        _send_error(501, 'system.dfu not supported on this bridge', req_id)\r
\r
\r
def _handle_timer(cmd, obj, req_id):\r
    global _timer_start\r
    action = cmd.split('.')[1]  # get, reset\r
    if action == 'get':\r
        elapsed_ms = time.ticks_diff(time.ticks_ms(), _timer_start)\r
        _sensor_event('timer', 'elapsed', elapsed_ms // 1000, req_id)\r
    elif action == 'reset':\r
        _timer_start = time.ticks_ms()\r
\r
\r
def _handle_orientation(cmd, obj, req_id):\r
    """v0.7 orientation.* command category."""\r
    global _orient_u, _orient_f, _orient_l, _yaw_acc, _yaw_zero\r
    global _cf_pitch, _cf_roll, _cf_last_ms\r
    action = cmd.split('.')[1]  # set_yaw, reset_yaw, set_reference\r
    try:\r
        if action == 'reset_yaw':\r
            _yaw_zero = _yaw_acc\r
        elif action == 'set_yaw':\r
            angle = int(obj.get('angle', 0))\r
            _yaw_zero = _yaw_acc - angle\r
        elif action == 'set_reference':\r
            face = obj.get('face', 'Top')\r
            f = _ORIENT_FRAMES.get(face, _ORIENT_FRAMES['Top'])\r
            _orient_u = (f[0], f[1], f[2])\r
            _orient_f = (f[3], f[4], f[5])\r
            _orient_l = (f[6], f[7], f[8])\r
            # Seed yaw from hardware if Top/Bottom, else start at 0.\r
            try:\r
                if abs(f[2]) > 0.5:  # Top or Bottom\r
                    raw = hub.motion_sensor.tilt_angles()\r
                    _yaw_acc = -raw[0] / 10.0\r
                else:\r
                    _yaw_acc = 0.0\r
            except Exception:\r
                _yaw_acc = 0.0\r
            _yaw_zero  = _yaw_acc  # reference point = current heading\r
            _cf_last_ms = 0\r
            # Seed filter from live accel so readings start at true value immediately.\r
            try:\r
                a = hub.motion_sensor.acceleration()\r
                ax, ay, az = a[0], a[1], a[2]\r
                au = _dot(_orient_u, (ax, ay, az))\r
                _cf_pitch = math.degrees(math.atan2(_dot(_orient_f, (ax, ay, az)), au))\r
                _cf_roll  = math.degrees(math.atan2(_dot(_orient_l, (ax, ay, az)), au))\r
            except Exception:\r
                _cf_pitch = 0.0\r
                _cf_roll  = 0.0\r
    except Exception as e:\r
        _send_error(301, 'Orientation error: ' + str(e), req_id)\r
\r
\r
def _read_button(name):\r
    """Read button state using hub.button.pressed(const) \u2014 SPIKE Prime 3.x API."""\r
    try:\r
        c = _BTN_CONST.get(name)\r
        if c is None:\r
            return 'released'\r
        return 'pressed' if hub.button.pressed(c) > 0 else 'released'\r
    except Exception:\r
        return 'released'\r
\r
\r
# ---------------------------------------------------------------------------\r
# Message callback\r
# ---------------------------------------------------------------------------\r
\r
def on_message(data):\r
    if not _json_ok:\r
        tunnel.send(b'{"event":"error","code":400,"message":"json not available"}\\n')\r
        return\r
\r
    if not isinstance(data, str):\r
        try:\r
            data = data.decode('utf-8')\r
        except Exception:\r
            data = ''.join(chr(b) for b in data)\r
\r
    try:\r
        obj = json.loads(data.strip())\r
    except Exception:\r
        _send_error(400, 'Malformed JSON')\r
        return\r
\r
    cmd = obj.get('cmd', '')\r
    req_id = obj.get('request_id', None)\r
\r
    try:\r
        if cmd.startswith('motor.'):\r
            _handle_motor(cmd, obj, req_id)\r
        elif cmd.startswith('movement.'):\r
            _handle_movement(cmd, obj, req_id)\r
        elif cmd.startswith('led.'):\r
            _handle_led(cmd, obj, req_id)\r
        elif cmd.startswith('sound.'):\r
            _handle_sound(cmd, obj, req_id)\r
        elif cmd.startswith('sensor.'):\r
            _handle_sensor(cmd, obj, req_id)\r
        elif cmd.startswith('system.'):\r
            _handle_system(cmd, obj, req_id)\r
        elif cmd.startswith('timer.'):\r
            _handle_timer(cmd, obj, req_id)\r
        elif cmd.startswith('orientation.'):\r
            _handle_orientation(cmd, obj, req_id)\r
        else:\r
            _send_error(400, 'Unknown command: ' + cmd, req_id)\r
    except Exception as e:\r
        _send_error(400, 'Handler error: ' + str(e), req_id)\r
\r
\r
# ---------------------------------------------------------------------------\r
# Startup\r
# ---------------------------------------------------------------------------\r
\r
def start():\r
    """Entry point \u2014 called when running on the SPIKE Prime hub."""\r
    # Pin global speaker volume to max so per-beep volume controls the full range.\r
    try:\r
        hub.sound.volume(100)\r
    except Exception:\r
        pass\r
    tunnel.callback(on_message)\r
    _send(_build_capability())\r
    _run_loop()\r
\r
\r
def _run_loop():\r
    """Main polling loop \u2014 subscriptions and heartbeat."""\r
    global _heartbeat_active\r
    while True:\r
        now = time.ticks_ms()\r
\r
        # Heartbeat: stop emitting if client stops pinging for 10 s\r
        if _heartbeat_active and _last_ping_ms is not None:\r
            if time.ticks_diff(now, _last_ping_ms) > 10000:\r
                _heartbeat_active = False\r
                _subscriptions.clear()\r
                _sys_subscriptions.clear()\r
\r
        # Update pitch/roll (complementary filter) and yaw every tick.\r
        _update_orientation(now)\r
\r
        # Fast-poll gesture subscriptions: check every 10 ms for _GESTURE_POLL_TICKS ticks.\r
        # 200 ms window catches shake and double_tap which need sustained/repeated motion.\r
        for pid, sub in list(_subscriptions.items()):\r
            if sub['type'] != 'gesture':\r
                continue\r
            for _ in range(_GESTURE_POLL_TICKS):\r
                try:\r
                    g = _GESTURE_MAP.get(hub.motion_sensor.gesture(), None)\r
                except Exception:\r
                    g = None\r
                if g is not None:\r
                    _sensor_event(pid, 'gesture', g)\r
                    sub['last_val'] = None\r
                    sub['last_ms'] = now\r
                    break\r
                time.sleep_ms(10)\r
\r
        # Sensor subscriptions\r
        for pid, sub in list(_subscriptions.items()):\r
            elapsed = time.ticks_diff(now, sub['last_ms'])\r
            if elapsed < sub['interval_ms']:\r
                continue\r
\r
            stype = sub['type']\r
            if stype == 'gesture':\r
                continue  # handled by fast-poll above\r
            val = _read_sensor_value(pid, stype)\r
\r
            if val is None:\r
                continue\r
\r
            mode = sub['mode']\r
            last_val = sub['last_val']\r
            min_change = sub['min_change']\r
\r
            should_emit = False\r
            if mode == 'interval':\r
                should_emit = True\r
            elif mode in ('on_change', 'hybrid'):\r
                if last_val is None:\r
                    should_emit = True\r
                elif min_change is not None:\r
                    try:\r
                        should_emit = abs(float(val) - float(last_val)) >= min_change\r
                    except (TypeError, ValueError):\r
                        should_emit = (val != last_val)\r
                else:\r
                    should_emit = (val != last_val)\r
\r
            if should_emit:\r
                _sensor_event(pid, stype, val)\r
                # Reset gestures to None after emit so the same gesture can fire again next time.\r
                sub['last_val'] = None if stype == 'gesture' else val\r
            sub['last_ms'] = now\r
\r
        # System metric subscriptions\r
        for metric, sub in list(_sys_subscriptions.items()):\r
            elapsed = time.ticks_diff(now, sub['last_ms'])\r
            if elapsed < sub['interval_ms']:\r
                continue\r
\r
            if metric.startswith('button.'):\r
                val = _read_button(metric.split('.')[1])\r
            else:\r
                val = _read_system_metric(metric)\r
\r
            if val is not None:\r
                # Only fire on actual change from a known baseline (not on first read).\r
                if sub['last_val'] is not None and val != sub['last_val']:\r
                    _system_event(metric, val)\r
                sub['last_val'] = val\r
            sub['last_ms'] = now\r
\r
        time.sleep_ms(50)\r
\r
\r
# Run when executed on the hub (MicroPython treats this as __main__)\r
if __name__ == '__main__':\r
    start()\r
`;

  // src/extension.js
  (function(Scratch2) {
    "use strict";
    if (!Scratch2.extensions.unsandboxed) {
      throw new Error("solaria-spike-prime must run unsandboxed (needs Web Bluetooth).");
    }
    const { BlockType, ArgumentType, Cast } = Scratch2;
    const PORTS = ["A", "B", "C", "D", "E", "F"];
    const DIRECTIONS = ["clockwise", "counterclockwise"];
    const STOP_ACTS = ["brake", "coast", "hold"];
    const COLORS = [
      "red",
      "orange",
      "yellow",
      "green",
      "cyan",
      "azure",
      "blue",
      "violet",
      "magenta",
      "white",
      "black"
    ];
    const HUB_FACES = ["Top", "Bottom", "Front", "Back", "Left side", "Right side"];
    const HUB_BUTTONS = ["Left", "Right"];
    const TILT_DIRS = ["forward", "backward", "left", "right", "any"];
    const TILT_AXES = ["pitch", "roll", "yaw"];
    const BTN_COLORS = [
      "azure",
      "black",
      "blue",
      "cyan",
      "green",
      "magenta",
      "orange",
      "red",
      "violet",
      "white",
      "yellow",
      "off"
    ];
    const IMAGES = [
      "HAPPY",
      "SAD",
      "SMILE",
      "HEART",
      "HEARTSMALL",
      "CONFUSED",
      "ANGRY",
      "ASLEEP",
      "SURPRISED",
      "YES",
      "NO",
      "ARROWNORTH",
      "ARROWEAST",
      "ARROWSOUTH",
      "ARROWWEST"
    ];
    const NOTES = [
      "C3",
      "Csharp3",
      "D3",
      "Dsharp3",
      "E3",
      "F3",
      "Fsharp3",
      "G3",
      "Gsharp3",
      "A3",
      "Asharp3",
      "B3",
      "C4",
      "Csharp4",
      "D4",
      "Dsharp4",
      "E4",
      "F4",
      "Fsharp4",
      "G4",
      "Gsharp4",
      "A4",
      "Asharp4",
      "B4",
      "C5",
      "Csharp5",
      "D5",
      "Dsharp5",
      "E5",
      "F5",
      "Fsharp5",
      "G5",
      "Gsharp5",
      "A5",
      "Asharp5",
      "B5",
      "C6",
      "Csharp6",
      "D6",
      "Dsharp6",
      "E6",
      "F6",
      "Fsharp6",
      "G6",
      "Gsharp6",
      "A6",
      "Asharp6",
      "B6",
      "C7"
    ];
    const NOTE_NAMES = ["C", "Csharp", "D", "Dsharp", "E", "F", "Fsharp", "G", "Gsharp", "A", "Asharp", "B"];
    const NOTE_MIDI = {};
    NOTES.forEach((n) => {
      const octave = parseInt(n.slice(-1), 10);
      const name = n.slice(0, -1);
      NOTE_MIDI[n] = (octave + 1) * 12 + NOTE_NAMES.indexOf(name);
    });
    const menuOf = (arr) => arr.map((v) => ({ text: v, value: v }));
    const signed = (dir, mag) => dir === "counterclockwise" ? -Math.abs(Cast.toNumber(mag)) : Math.abs(Cast.toNumber(mag));
    let client = null;
    let leftPort = "E", rightPort = "F";
    let tempo = 120;
    const flags = {
      hubConnected: false,
      hubDisconnected: false,
      colorChanged: {},
      // port → bool
      distanceChanged: {},
      // port → bool
      buttonPressed: { Left: false, Right: false },
      buttonReleased: { Left: false, Right: false }
    };
    const buttonState = { Left: false, Right: false };
    function onClientEvent(ev) {
      if (ev.type === "connected") {
        flags.hubConnected = true;
      } else if (ev.type === "disconnected") {
        flags.hubDisconnected = true;
        client = null;
      } else if (ev.type === "ssp") {
        routeSSP(ev.event);
      }
    }
    function routeSSP(ev) {
      if (!ev) return;
      if (ev.event === "sensor") {
        if (ev.type === "color") flags.colorChanged[ev.port] = true;
        if (ev.type === "distance") flags.distanceChanged[ev.port] = true;
      } else if (ev.event === "system") {
        if (ev.metric === "button.left" || ev.metric === "button.right") {
          const btn = ev.metric === "button.left" ? "Left" : "Right";
          const pressed = ev.value === "pressed";
          const was = buttonState[btn];
          buttonState[btn] = pressed;
          if (pressed && !was) flags.buttonPressed[btn] = true;
          if (!pressed && was) flags.buttonReleased[btn] = true;
        }
      }
    }
    function send(cmd) {
      if (!client) return Promise.resolve();
      return client.sendSSP(cmd).catch(() => {
      });
    }
    function requestEvent(cmd, matchFn, timeoutMs = 3e3) {
      return new Promise((resolve) => {
        if (!client) return resolve(null);
        let done = false;
        const finish = (v) => {
          if (!done) {
            done = true;
            client.off(handler);
            resolve(v);
          }
        };
        const handler = (e) => {
          if (e.type === "ssp" && matchFn(e.event)) finish(e.event);
          else if (e.type === "disconnected") finish(null);
        };
        client.on(handler);
        client.sendSSP(cmd).catch(() => finish(null));
        setTimeout(() => finish(null), timeoutMs);
      });
    }
    const sensorMatch = (port, type) => (ev) => ev.event === "sensor" && ev.port === port && ev.type === type;
    const systemMatch = (metric) => (ev) => ev.event === "system" && ev.metric === metric;
    async function readSensor(port, type, def) {
      const ev = await requestEvent({ cmd: "sensor.read", port, type }, sensorMatch(port, type));
      return ev ? ev.value : def;
    }
    const waitMs = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
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
            {
              opcode: "startMotor",
              blockType: BlockType.COMMAND,
              text: "start motor [PORT] [DIRECTION] at [SPEED] %",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
                DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "clockwise" },
                SPEED: { type: ArgumentType.NUMBER, defaultValue: 75 }
              }
            },
            {
              opcode: "stopMotor",
              blockType: BlockType.COMMAND,
              text: "stop motor [PORT] [ACTION]",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
                ACTION: { type: ArgumentType.STRING, menu: "stopActions", defaultValue: "brake" }
              }
            },
            {
              opcode: "runMotorForSeconds",
              blockType: BlockType.COMMAND,
              text: "run motor [PORT] [DIRECTION] at [SPEED] % for [SECS] seconds",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
                DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "clockwise" },
                SPEED: { type: ArgumentType.NUMBER, defaultValue: 75 },
                SECS: { type: ArgumentType.NUMBER, defaultValue: 1 }
              }
            },
            {
              opcode: "runMotorForDegrees",
              blockType: BlockType.COMMAND,
              text: "run motor [PORT] [DIRECTION] at [SPEED] % for [DEG] degrees",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
                DIRECTION: { type: ArgumentType.STRING, menu: "directions", defaultValue: "clockwise" },
                SPEED: { type: ArgumentType.NUMBER, defaultValue: 75 },
                DEG: { type: ArgumentType.NUMBER, defaultValue: 360 }
              }
            },
            {
              opcode: "goToMotorPosition",
              blockType: BlockType.COMMAND,
              text: "go to motor [PORT] absolute position [POS]\xB0 at [SPEED] %",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
                POS: { type: ArgumentType.NUMBER, defaultValue: 0 },
                SPEED: { type: ArgumentType.NUMBER, defaultValue: 75 }
              }
            },
            {
              opcode: "setMotorAcceleration",
              blockType: BlockType.COMMAND,
              text: "set motor [PORT] acceleration to [RATE] ms",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" },
                RATE: { type: ArgumentType.NUMBER, defaultValue: 500 }
              }
            },
            {
              opcode: "resetMotorPosition",
              blockType: BlockType.COMMAND,
              text: "reset motor [PORT] position",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } }
            },
            {
              opcode: "getMotorPosition",
              blockType: BlockType.REPORTER,
              text: "motor [PORT] position (degrees)",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } }
            },
            {
              opcode: "getMotorSpeed",
              blockType: BlockType.REPORTER,
              text: "motor [PORT] speed (%)",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "A" } }
            },
            "---",
            { blockType: BlockType.LABEL, text: "Movement" },
            {
              opcode: "setMovementPair",
              blockType: BlockType.COMMAND,
              text: "set movement motors [LEFT] (left) [RIGHT] (right)",
              arguments: {
                LEFT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "E" },
                RIGHT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "F" }
              }
            },
            {
              opcode: "startMoving",
              blockType: BlockType.COMMAND,
              text: "start moving at [SPEED] %",
              arguments: { SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 } }
            },
            {
              opcode: "startMovingWithSteering",
              blockType: BlockType.COMMAND,
              text: "start moving at [SPEED] % with steering [STEER]",
              arguments: {
                SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 },
                STEER: { type: ArgumentType.NUMBER, defaultValue: 0 }
              }
            },
            { opcode: "stopMoving", blockType: BlockType.COMMAND, text: "stop moving" },
            {
              opcode: "moveForDegrees",
              blockType: BlockType.COMMAND,
              text: "move [DEG] degrees at [SPEED] %",
              arguments: {
                DEG: { type: ArgumentType.NUMBER, defaultValue: 360 },
                SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 }
              }
            },
            {
              opcode: "moveForRotations",
              blockType: BlockType.COMMAND,
              text: "move [ROT] rotations at [SPEED] %",
              arguments: {
                ROT: { type: ArgumentType.NUMBER, defaultValue: 1 },
                SPEED: { type: ArgumentType.NUMBER, defaultValue: 50 }
              }
            },
            {
              opcode: "setMovementAcceleration",
              blockType: BlockType.COMMAND,
              text: "set movement acceleration to [RATE] ms",
              arguments: { RATE: { type: ArgumentType.NUMBER, defaultValue: 500 } }
            },
            "---",
            { blockType: BlockType.LABEL, text: "Light" },
            {
              opcode: "showImage",
              blockType: BlockType.COMMAND,
              text: "show image [IMAGE]",
              arguments: { IMAGE: { type: ArgumentType.STRING, menu: "images", defaultValue: "HAPPY" } }
            },
            { opcode: "clearLightMatrix", blockType: BlockType.COMMAND, text: "turn off light matrix" },
            {
              opcode: "writeOnLightMatrix",
              blockType: BlockType.COMMAND,
              text: "write [TEXT] on light matrix",
              arguments: { TEXT: { type: ArgumentType.STRING, defaultValue: "Hi" } }
            },
            {
              opcode: "setPixel",
              blockType: BlockType.COMMAND,
              text: "set pixel col [X] row [Y] to brightness [B] %",
              arguments: {
                X: { type: ArgumentType.NUMBER, defaultValue: 3 },
                Y: { type: ArgumentType.NUMBER, defaultValue: 3 },
                B: { type: ArgumentType.NUMBER, defaultValue: 100 }
              }
            },
            {
              opcode: "setLightMatrixBrightness",
              blockType: BlockType.COMMAND,
              text: "set light matrix brightness to [LEVEL] %",
              arguments: { LEVEL: { type: ArgumentType.NUMBER, defaultValue: 100 } }
            },
            {
              opcode: "setCenterButtonLight",
              blockType: BlockType.COMMAND,
              text: "set center button light to [COLOR]",
              arguments: { COLOR: { type: ArgumentType.STRING, menu: "btnColors", defaultValue: "azure" } }
            },
            {
              opcode: "lightUpDistanceSensor",
              blockType: BlockType.COMMAND,
              text: "light distance sensor [PORT] TL [TL] TR [TR] BL [BL] BR [BR]",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" },
                TL: { type: ArgumentType.NUMBER, defaultValue: 100 },
                TR: { type: ArgumentType.NUMBER, defaultValue: 100 },
                BL: { type: ArgumentType.NUMBER, defaultValue: 100 },
                BR: { type: ArgumentType.NUMBER, defaultValue: 100 }
              }
            },
            "---",
            { blockType: BlockType.LABEL, text: "Sensors" },
            {
              opcode: "getColor",
              blockType: BlockType.REPORTER,
              text: "color at [PORT]",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } }
            },
            {
              opcode: "getDistance",
              blockType: BlockType.REPORTER,
              text: "distance at [PORT] (mm)",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } }
            },
            {
              opcode: "getForce",
              blockType: BlockType.REPORTER,
              text: "force at [PORT] (N)",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "D" } }
            },
            {
              opcode: "getReflectedLight",
              blockType: BlockType.REPORTER,
              text: "reflected light at [PORT] (%)",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } }
            },
            {
              opcode: "isColor",
              blockType: BlockType.BOOLEAN,
              text: "color at [PORT] is [COLOR]?",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" },
                COLOR: { type: ArgumentType.STRING, menu: "colors", defaultValue: "red" }
              }
            },
            {
              opcode: "isCloserThan",
              blockType: BlockType.BOOLEAN,
              text: "distance at [PORT] closer than [MM] mm?",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" },
                MM: { type: ArgumentType.NUMBER, defaultValue: 100 }
              }
            },
            {
              opcode: "isReflectedLightAbove",
              blockType: BlockType.BOOLEAN,
              text: "reflected light at [PORT] above [PCT] %?",
              arguments: {
                PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" },
                PCT: { type: ArgumentType.NUMBER, defaultValue: 50 }
              }
            },
            {
              opcode: "isForceSensorPressed",
              blockType: BlockType.BOOLEAN,
              text: "force sensor at [PORT] pressed?",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "D" } }
            },
            {
              opcode: "getTiltAngle",
              blockType: BlockType.REPORTER,
              text: "hub tilt angle [AXIS]",
              arguments: { AXIS: { type: ArgumentType.STRING, menu: "tiltAxes", defaultValue: "pitch" } }
            },
            {
              opcode: "isTilted",
              blockType: BlockType.BOOLEAN,
              text: "hub tilted [DIRECTION]?",
              arguments: { DIRECTION: { type: ArgumentType.STRING, menu: "tiltDirs", defaultValue: "forward" } }
            },
            {
              opcode: "isHubOrientation",
              blockType: BlockType.BOOLEAN,
              text: "hub face [FACE] up?",
              arguments: { FACE: { type: ArgumentType.STRING, menu: "hubFaces", defaultValue: "Top" } }
            },
            { opcode: "isShaking", blockType: BlockType.BOOLEAN, text: "hub shaking?" },
            {
              opcode: "isHubButtonPressed",
              blockType: BlockType.BOOLEAN,
              text: "hub [BUTTON] button pressed?",
              arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } }
            },
            { opcode: "getHubTimer", blockType: BlockType.REPORTER, text: "hub timer (seconds)" },
            { opcode: "resetHubTimer", blockType: BlockType.COMMAND, text: "reset hub timer" },
            {
              opcode: "whenColorRead",
              blockType: BlockType.HAT,
              isEdgeActivated: false,
              text: "when color changes at [PORT]",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } }
            },
            {
              opcode: "whenDistanceRead",
              blockType: BlockType.HAT,
              isEdgeActivated: false,
              text: "when distance changes at [PORT]",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } }
            },
            {
              opcode: "whenHubButtonPressed",
              blockType: BlockType.HAT,
              isEdgeActivated: false,
              text: "when hub [BUTTON] button pressed",
              arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } }
            },
            {
              opcode: "whenHubButtonReleased",
              blockType: BlockType.HAT,
              isEdgeActivated: false,
              text: "when hub [BUTTON] button released",
              arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } }
            },
            {
              opcode: "subscribeToColor",
              blockType: BlockType.COMMAND,
              text: "subscribe to color sensor at [PORT]",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "C" } }
            },
            {
              opcode: "subscribeToDistance",
              blockType: BlockType.COMMAND,
              text: "subscribe to distance sensor at [PORT]",
              arguments: { PORT: { type: ArgumentType.STRING, menu: "ports", defaultValue: "B" } }
            },
            {
              opcode: "subscribeToHubButton",
              blockType: BlockType.COMMAND,
              text: "subscribe to hub [BUTTON] button",
              arguments: { BUTTON: { type: ArgumentType.STRING, menu: "hubButtons", defaultValue: "Left" } }
            },
            "---",
            { blockType: BlockType.LABEL, text: "Sound" },
            {
              opcode: "beep",
              blockType: BlockType.COMMAND,
              text: "beep at [FREQ] Hz for [DUR] ms",
              arguments: {
                FREQ: { type: ArgumentType.NUMBER, defaultValue: 440 },
                DUR: { type: ArgumentType.NUMBER, defaultValue: 500 }
              }
            },
            {
              opcode: "startBeep",
              blockType: BlockType.COMMAND,
              text: "start beeping at [FREQ] Hz",
              arguments: { FREQ: { type: ArgumentType.NUMBER, defaultValue: 440 } }
            },
            { opcode: "stopAllSounds", blockType: BlockType.COMMAND, text: "stop all sounds" },
            {
              opcode: "setVolume",
              blockType: BlockType.COMMAND,
              text: "set hub volume to [LEVEL] %",
              arguments: { LEVEL: { type: ArgumentType.NUMBER, defaultValue: 75 } }
            },
            { opcode: "getVolume", blockType: BlockType.REPORTER, text: "hub volume (%)" },
            "---",
            { blockType: BlockType.LABEL, text: "System" },
            { opcode: "getBatteryLevel", blockType: BlockType.REPORTER, text: "hub battery (%)" },
            { opcode: "getTemperature", blockType: BlockType.REPORTER, text: "hub temperature (\xB0C)" },
            { opcode: "isCharging", blockType: BlockType.BOOLEAN, text: "hub charging?" },
            "---",
            { blockType: BlockType.LABEL, text: "Music" },
            {
              opcode: "playNoteForBeats",
              blockType: BlockType.COMMAND,
              text: "play note [NOTE] for [BEATS] beats",
              arguments: {
                NOTE: { type: ArgumentType.STRING, menu: "notes", defaultValue: "A4" },
                BEATS: { type: ArgumentType.NUMBER, defaultValue: 1 }
              }
            },
            {
              opcode: "restForBeats",
              blockType: BlockType.COMMAND,
              text: "rest for [BEATS] beats",
              arguments: { BEATS: { type: ArgumentType.NUMBER, defaultValue: 1 } }
            },
            {
              opcode: "setTempo",
              blockType: BlockType.COMMAND,
              text: "set tempo to [BPM] BPM",
              arguments: { BPM: { type: ArgumentType.NUMBER, defaultValue: 120 } }
            },
            {
              opcode: "changeTempo",
              blockType: BlockType.COMMAND,
              text: "change tempo by [DELTA] BPM",
              arguments: { DELTA: { type: ArgumentType.NUMBER, defaultValue: 10 } }
            },
            { opcode: "getTempo", blockType: BlockType.REPORTER, text: "tempo (BPM)" }
          ],
          menus: {
            ports: { acceptReporters: true, items: menuOf(PORTS) },
            directions: { acceptReporters: true, items: menuOf(DIRECTIONS) },
            stopActions: { acceptReporters: true, items: menuOf(STOP_ACTS) },
            colors: { acceptReporters: true, items: menuOf(COLORS) },
            hubFaces: { acceptReporters: true, items: menuOf(HUB_FACES) },
            hubButtons: { acceptReporters: true, items: menuOf(HUB_BUTTONS) },
            tiltDirs: { acceptReporters: true, items: menuOf(TILT_DIRS) },
            tiltAxes: { acceptReporters: true, items: menuOf(TILT_AXES) },
            btnColors: { acceptReporters: true, items: menuOf(BTN_COLORS) },
            images: { acceptReporters: true, items: menuOf(IMAGES) },
            notes: { acceptReporters: true, items: menuOf(NOTES) }
          }
        };
      }
      // ── Connectivity ────────────────────────────────────────────────────────────
      async connect() {
        try {
          client = new SpikeClient(new WebBleTransport(), hub_controller_default);
          client.on(onClientEvent);
          await client.connect();
        } catch (e) {
          client = null;
          console.error("[SolariaSpikePrime] connect error:", e);
        }
      }
      async disconnect() {
        if (client) await client.disconnect().catch(() => {
        });
      }
      isConnected() {
        return !!client;
      }
      whenHubConnected() {
        const v = flags.hubConnected;
        flags.hubConnected = false;
        return v;
      }
      whenHubDisconnected() {
        const v = flags.hubDisconnected;
        flags.hubDisconnected = false;
        return v;
      }
      // ── Motors ──────────────────────────────────────────────────────────────────
      startMotor({ PORT, DIRECTION, SPEED }) {
        return send({ cmd: "motor.run", port: PORT, speed: signed(DIRECTION, SPEED) });
      }
      stopMotor({ PORT, ACTION }) {
        return send({ cmd: "motor.stop", port: PORT, stop_action: ACTION });
      }
      runMotorForSeconds({ PORT, DIRECTION, SPEED, SECS }) {
        return send({
          cmd: "motor.run",
          port: PORT,
          speed: signed(DIRECTION, SPEED),
          duration: Math.round(Cast.toNumber(SECS) * 1e3),
          duration_unit: "ms"
        });
      }
      runMotorForDegrees({ PORT, DIRECTION, SPEED, DEG }) {
        return send({
          cmd: "motor.run",
          port: PORT,
          speed: signed(DIRECTION, SPEED),
          duration: Cast.toNumber(DEG),
          duration_unit: "degrees"
        });
      }
      goToMotorPosition({ PORT, POS, SPEED }) {
        const pos = Math.max(0, Math.min(359, Cast.toNumber(POS)));
        return send({
          cmd: "motor.goto",
          port: PORT,
          position: pos,
          speed: Math.abs(Cast.toNumber(SPEED)),
          mode: "absolute"
        });
      }
      setMotorAcceleration({ PORT, RATE }) {
        return send({
          cmd: "motor.set_acceleration",
          port: PORT,
          rate: Math.max(0, Math.min(1e4, Cast.toNumber(RATE)))
        });
      }
      resetMotorPosition({ PORT }) {
        return send({ cmd: "motor.reset", port: PORT });
      }
      getMotorPosition({ PORT }) {
        return readSensor(PORT, "position", 0);
      }
      getMotorSpeed({ PORT }) {
        return readSensor(PORT, "speed", 0);
      }
      // ── Movement ──────────────────────────────────────────────────────────────────
      setMovementPair({ LEFT, RIGHT }) {
        leftPort = LEFT;
        rightPort = RIGHT;
        return send({ cmd: "movement.configure", left: LEFT, right: RIGHT });
      }
      startMoving({ SPEED }) {
        return send({
          cmd: "movement.drive",
          left: leftPort,
          right: rightPort,
          speed: Cast.toNumber(SPEED),
          steering: 0
        });
      }
      startMovingWithSteering({ SPEED, STEER }) {
        return send({
          cmd: "movement.drive",
          left: leftPort,
          right: rightPort,
          speed: Cast.toNumber(SPEED),
          steering: Math.max(-100, Math.min(100, Cast.toNumber(STEER)))
        });
      }
      stopMoving() {
        return send({ cmd: "movement.stop", stop_action: "brake" });
      }
      moveForDegrees({ DEG, SPEED }) {
        return send({
          cmd: "movement.drive",
          left: leftPort,
          right: rightPort,
          speed: Cast.toNumber(SPEED),
          steering: 0,
          duration: Cast.toNumber(DEG),
          duration_unit: "degrees"
        });
      }
      moveForRotations({ ROT, SPEED }) {
        return send({
          cmd: "movement.drive",
          left: leftPort,
          right: rightPort,
          speed: Cast.toNumber(SPEED),
          steering: 0,
          duration: Cast.toNumber(ROT),
          duration_unit: "rotations"
        });
      }
      setMovementAcceleration({ RATE }) {
        return send({
          cmd: "movement.set_acceleration",
          rate: Math.max(0, Math.min(1e4, Cast.toNumber(RATE)))
        });
      }
      // ── Light ──────────────────────────────────────────────────────────────────────
      showImage({ IMAGE }) {
        return send({ cmd: "led.matrix.image", port: "display", image: Cast.toString(IMAGE).toUpperCase() });
      }
      clearLightMatrix() {
        return send({ cmd: "led.matrix.clear", port: "display" });
      }
      writeOnLightMatrix({ TEXT }) {
        return send({ cmd: "led.matrix.text", port: "display", text: Cast.toString(TEXT) });
      }
      setPixel({ X, Y, B }) {
        return send({
          cmd: "led.matrix.pixel",
          port: "display",
          x: Math.max(1, Math.min(5, Cast.toNumber(X))) - 1,
          y: Math.max(1, Math.min(5, Cast.toNumber(Y))) - 1,
          brightness: Math.max(0, Math.min(100, Cast.toNumber(B)))
        });
      }
      setLightMatrixBrightness({ LEVEL }) {
        return send({
          cmd: "led.matrix.brightness",
          port: "display",
          level: Math.max(0, Math.min(100, Cast.toNumber(LEVEL)))
        });
      }
      setCenterButtonLight({ COLOR }) {
        return send({ cmd: "led.set", port: "status", color: Cast.toString(COLOR) });
      }
      lightUpDistanceSensor({ PORT, TL, TR, BL, BR }) {
        const c = (v) => Math.max(0, Math.min(100, Cast.toNumber(v)));
        return send({ cmd: "led.distance", port: PORT, tl: c(TL), tr: c(TR), bl: c(BL), br: c(BR) });
      }
      // ── Sensors (reporters & booleans use one-shot request/response) ────────────────
      getColor({ PORT }) {
        return readSensor(PORT, "color", "");
      }
      getDistance({ PORT }) {
        return readSensor(PORT, "distance", -1);
      }
      getForce({ PORT }) {
        return readSensor(PORT, "force", 0);
      }
      getReflectedLight({ PORT }) {
        return readSensor(PORT, "reflected", 0);
      }
      async isColor({ PORT, COLOR }) {
        const ev = await requestEvent(
          { cmd: "sensor.read", port: PORT, type: "is_color", color: Cast.toString(COLOR).toLowerCase() },
          sensorMatch(PORT, "is_color")
        );
        return !!(ev && ev.value && ev.value.match);
      }
      async isCloserThan({ PORT, MM }) {
        const ev = await requestEvent(
          { cmd: "sensor.read", port: PORT, type: "is_closer", mm: Cast.toNumber(MM) },
          sensorMatch(PORT, "is_closer")
        );
        return !!(ev && ev.value);
      }
      async isReflectedLightAbove({ PORT, PCT }) {
        const ev = await requestEvent(
          { cmd: "sensor.read", port: PORT, type: "is_reflected_above", percent: Cast.toNumber(PCT) },
          sensorMatch(PORT, "is_reflected_above")
        );
        return !!(ev && ev.value);
      }
      isForceSensorPressed({ PORT }) {
        return requestEvent(
          { cmd: "sensor.read", port: PORT, type: "touched" },
          sensorMatch(PORT, "touched")
        ).then((ev) => !!(ev && ev.value));
      }
      getTiltAngle({ AXIS }) {
        return readSensor("imu", Cast.toString(AXIS).toLowerCase(), 0);
      }
      async isTilted({ DIRECTION }) {
        const dir = Cast.toString(DIRECTION).toLowerCase();
        const ev = await requestEvent(
          { cmd: "sensor.read", port: "imu", type: "is_tilted", direction: dir },
          sensorMatch("imu", "is_tilted")
        );
        return !!(ev && ev.value && ev.value.tilted);
      }
      async isHubOrientation({ FACE }) {
        const ev = await requestEvent(
          { cmd: "sensor.read", port: "imu", type: "is_orientation", face: FACE },
          sensorMatch("imu", "is_orientation")
        );
        return !!(ev && ev.value && ev.value.match);
      }
      async isShaking() {
        const ev = await requestEvent(
          { cmd: "sensor.read", port: "imu", type: "is_shaking" },
          sensorMatch("imu", "is_shaking")
        );
        return !!(ev && ev.value);
      }
      async isHubButtonPressed({ BUTTON }) {
        const name = Cast.toString(BUTTON).toLowerCase();
        const ev = await requestEvent(
          { cmd: "system.read", metric: "is_button_pressed", button: name },
          systemMatch("is_button_pressed")
        );
        return !!(ev && ev.value && ev.value.pressed);
      }
      async getHubTimer() {
        const ev = await requestEvent({ cmd: "timer.get" }, sensorMatch("timer", "elapsed"));
        return ev ? ev.value : 0;
      }
      resetHubTimer() {
        return send({ cmd: "timer.reset" });
      }
      whenColorRead({ PORT }) {
        const v = !!flags.colorChanged[PORT];
        flags.colorChanged[PORT] = false;
        return v;
      }
      whenDistanceRead({ PORT }) {
        const v = !!flags.distanceChanged[PORT];
        flags.distanceChanged[PORT] = false;
        return v;
      }
      whenHubButtonPressed({ BUTTON }) {
        const v = !!flags.buttonPressed[BUTTON];
        flags.buttonPressed[BUTTON] = false;
        return v;
      }
      whenHubButtonReleased({ BUTTON }) {
        const v = !!flags.buttonReleased[BUTTON];
        flags.buttonReleased[BUTTON] = false;
        return v;
      }
      subscribeToColor({ PORT }) {
        return send({ cmd: "sensor.subscribe", port: PORT, type: "color", mode: "on_change" });
      }
      subscribeToDistance({ PORT }) {
        return send({ cmd: "sensor.subscribe", port: PORT, type: "distance", mode: "on_change" });
      }
      subscribeToHubButton({ BUTTON }) {
        return send({ cmd: "system.subscribe", metric: "button." + Cast.toString(BUTTON).toLowerCase(), interval: 100 });
      }
      // ── Sound ──────────────────────────────────────────────────────────────────────
      beep({ FREQ, DUR }) {
        return send({ cmd: "sound.beep", freq: Cast.toNumber(FREQ), duration: Cast.toNumber(DUR) });
      }
      startBeep({ FREQ }) {
        return send({ cmd: "sound.beep", freq: Cast.toNumber(FREQ) });
      }
      stopAllSounds() {
        return send({ cmd: "sound.stop" });
      }
      setVolume({ LEVEL }) {
        return send({ cmd: "sound.set_volume", level: Math.max(0, Math.min(100, Cast.toNumber(LEVEL))) });
      }
      async getVolume() {
        const ev = await requestEvent(
          { cmd: "sound.read", metric: "volume" },
          (e) => e.event === "sound" && e.metric === "volume"
        );
        return ev ? ev.value : 0;
      }
      // ── System ──────────────────────────────────────────────────────────────────────
      async getBatteryLevel() {
        const ev = await requestEvent({ cmd: "system.read", metric: "battery" }, systemMatch("battery"));
        return ev ? ev.value : 0;
      }
      async getTemperature() {
        const ev = await requestEvent({ cmd: "system.read", metric: "temperature" }, systemMatch("temperature"));
        return ev ? ev.value : 0;
      }
      async isCharging() {
        const ev = await requestEvent({ cmd: "system.read", metric: "charging" }, systemMatch("charging"));
        return !!(ev && ev.value);
      }
      // ── Music (client-side tempo; await duration so notes sequence in Scratch) ───────
      async playNoteForBeats({ NOTE, BEATS }) {
        const midi = NOTE_MIDI[NOTE] ?? 69;
        const freq = Math.round(440 * Math.pow(2, (midi - 69) / 12));
        const ms = Math.round(6e4 / tempo * Cast.toNumber(BEATS));
        await send({ cmd: "sound.beep", freq, duration: ms, wait: true });
        await waitMs(ms);
      }
      async restForBeats({ BEATS }) {
        const ms = Math.round(6e4 / tempo * Cast.toNumber(BEATS));
        await send({ cmd: "sound.rest", duration: ms });
        await waitMs(ms);
      }
      setTempo({ BPM }) {
        tempo = Math.max(1, Cast.toNumber(BPM));
      }
      changeTempo({ DELTA }) {
        tempo = Math.max(1, tempo + Cast.toNumber(DELTA));
      }
      getTempo() {
        return tempo;
      }
    }
    Scratch2.extensions.register(new SolariaSpikePrime());
  })(Scratch);
})();
