// Build script — bundles src/extension.js → extension.js (single file, IIFE).
// The .py file is inlined as a text import via a custom esbuild plugin.
// Run: node build.js [--watch]
import esbuild from "esbuild";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes("--watch");

// Plugin: load *.py files as a default-exported string constant.
const pyTextPlugin = {
  name: "py-text",
  setup(build) {
    build.onLoad({ filter: /\.py$/ }, (args) => {
      const text = readFileSync(args.path, "utf8");
      return { contents: `export default ${JSON.stringify(text)};`, loader: "js" };
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: [resolve(__dirname, "src/extension.js")],
  bundle: true,
  format: "iife",
  // Expose nothing as a global — the IIFE self-registers via Scratch.extensions.register().
  // Scratch is a page-level global injected by TurboWarp; mark it external.
  globalName: undefined,
  platform: "browser",
  target: ["chrome90"],
  outfile: resolve(__dirname, "extension.js"),
  plugins: [pyTextPlugin],
  // Resolve @solaria/spike-prime to the local TypeScript source (no publish required).
  alias: {
    "@solaria/spike-prime": resolve(__dirname, "../solaria-lib-spike-prime/web/src/index.ts"),
  },
  // esbuild handles .ts natively; no tsconfig needed for bundling.
  loader: { ".ts": "ts" },
  banner: {
    js: [
      "// solaria-scratch-spike-prime — AUTO-GENERATED, do not edit.",
      "// Source: src/extension.js  •  Built with: node build.js",
      "// Unofficial LEGO® SPIKE™ Prime extension for TurboWarp/PenguinMod.",
    ].join("\n"),
  },
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes…");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
