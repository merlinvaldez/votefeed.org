// Run from the repository root: node tests/helpers/legislative-card-preview.mjs
// Optional: $env:CARD_PREVIEW_PORT="4183"
import { createServer } from "../../client/node_modules/vite/dist/node/index.js";
import react from "../../client/node_modules/@vitejs/plugin-react-swc/index.js";
import { readFile } from "node:fs/promises";
const server = await createServer({ root: process.cwd() + "/client", configFile: false, envDir: false, cacheDir: "node_modules/.vite-card-preview",
  plugins: [{ name: "card-preview", enforce: "pre", async load(id) {
    if (id.replaceAll("\\", "/").endsWith("/src/main.jsx")) {
      return readFile(new URL("./legislative-card-fixture.jsx", import.meta.url), "utf8");
    }
  } }, react()], server: { host: "127.0.0.1", port: Number(process.env.CARD_PREVIEW_PORT || 4182), strictPort: true } });
await server.listen();
console.log(`Card preview: ${server.resolvedUrls.local[0]}`);
