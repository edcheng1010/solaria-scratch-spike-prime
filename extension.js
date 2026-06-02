// solaria-scratch-spike-prime — TurboWarp/PenguinMod UNSANDBOXED extension skeleton.
// Wraps the @solaria/spike-prime Web Bluetooth bridge (bundled at build time).
// Block surface mirrors the App Inventor extension's 8 components with the same LEGO-aligned names.
//
// NOTE: This is a Phase 4a scaffold. Block defs + connect flow are stubbed; the SpikeClient bridge
// must be bundled in (see ../solaria-lib-spike-prime/web) before these blocks do anything.

(function (Scratch) {
  "use strict";
  if (!Scratch.extensions.unsandboxed) {
    throw new Error("solaria-spike-prime must run unsandboxed (needs Web Bluetooth).");
  }

  // const { SpikeClient, WebBleTransport } = SolariaSpikePrime; // injected by the bundle
  // const HUB_PROGRAM = "<hub_controller.py bundled as string>";

  class SolariaSpikePrime {
    constructor() {
      this.client = null;      // SpikeClient instance once connected
      this.lastColor = "";     // request→cache pattern for reporter blocks
      this.lastDistance = -1;
    }

    getInfo() {
      return {
        id: "solariaspikeprime",
        name: "SPIKE Prime",
        color1: "#0090C8",
        blocks: [
          // --- Connectivity ---
          { opcode: "connect", blockType: Scratch.BlockType.COMMAND, text: "connect to SPIKE Prime" },
          { opcode: "isConnected", blockType: Scratch.BlockType.BOOLEAN, text: "connected?" },

          // --- Motors (examples; full surface mirrors LegoSpikeMotors) ---
          { opcode: "startMotor", blockType: Scratch.BlockType.COMMAND,
            text: "start motor [PORT] at [SPEED] %",
            arguments: {
              PORT: { type: Scratch.ArgumentType.STRING, defaultValue: "A" },
              SPEED: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
            } },
          { opcode: "stopMotor", blockType: Scratch.BlockType.COMMAND,
            text: "stop motor [PORT]",
            arguments: { PORT: { type: Scratch.ArgumentType.STRING, defaultValue: "A" } } },

          // --- Sensors (reporter via request→cache; boolean; hat) ---
          { opcode: "getColor", blockType: Scratch.BlockType.REPORTER, text: "color at [PORT]",
            arguments: { PORT: { type: Scratch.ArgumentType.STRING, defaultValue: "C" } } },
          { opcode: "whenButton", blockType: Scratch.BlockType.HAT,
            text: "when [BTN] button pressed",
            arguments: { BTN: { type: Scratch.ArgumentType.STRING, defaultValue: "left" } } },

          // TODO: full block surface — Movement, Light, Sound, System, Music, all sensor checks.
        ],
      };
    }

    // MUST be triggered by this block click (user gesture for Web Bluetooth).
    async connect() {
      // this.client = new SpikeClient(new WebBleTransport(), HUB_PROGRAM);
      // await this.client.connect();
      throw new Error("TODO: wire SpikeClient bridge");
    }
    isConnected() { return !!this.client; }
    async startMotor(args) { /* this.client.sendSSP({cmd:"motor.run", port:args.PORT, speed:args.SPEED}); */ }
    async stopMotor(args) { /* this.client.sendSSP({cmd:"motor.stop", port:args.PORT}); */ }
    getColor() { return this.lastColor; }
    whenButton() { return false; /* driven by bridge events */ }
  }

  Scratch.extensions.register(new SolariaSpikePrime());
})(Scratch);
