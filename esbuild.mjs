import * as esbuild from "esbuild";
import { copyFileSync } from "fs";

const isWatch = process.argv.includes("--watch");

// Plugin: resolve maplibre-gl imports to the CDN global
const maplibreGlobalPlugin = {
  name: "maplibre-global",
  setup(build) {
    build.onResolve({ filter: /^(maplibre-gl|mapbox-gl)$/ }, (args) => ({
      path: args.path,
      namespace: "maplibre-global",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "maplibre-global" },
      () => ({
        contents: "module.exports = globalThis.maplibregl;",
        loader: "js",
      })
    );
  },
};

// Extension host bundle (Node.js / CJS)
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: "dist/extension.js",
  external: ["vscode"],
  sourcemap: true,
  minify: !isWatch,
};

// Webview bundle (browser / ESM — needed for top-level await in deps)
const webviewConfig = {
  entryPoints: ["webview/main.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "dist/webview.js",
  sourcemap: true,
  minify: !isWatch,
  plugins: [maplibreGlobalPlugin],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  alias: {
    http: "./webview/shims/empty.js",
    https: "./webview/shims/empty.js",
    url: "./webview/shims/empty.js",
  },
};

if (isWatch) {
  const ctx1 = await esbuild.context(extensionConfig);
  const ctx2 = await esbuild.context(webviewConfig);
  await ctx1.watch();
  await ctx2.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(extensionConfig);
  await esbuild.build(webviewConfig);
  copyFileSync("webview/viewer.html", "dist/viewer.html");
  console.log("Build complete.");
}
