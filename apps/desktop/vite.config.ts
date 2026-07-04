/**
 * Vite config for the sandboxed Electron renderer (React SPA).
 * Output lands in dist/renderer for main process loadFile in production.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(__dirname, "renderer");
const coreDistRoot = path.resolve(__dirname, "../../packages/core/dist");

/** core dist 在 tsc-alias 未跑时仍含 `@/`；不可落到 renderer 的 `@` alias。 */
function isCoreDistModule(importer: string | undefined): boolean {
  if (importer == null) {
    return false;
  }
  const normalized = path.normalize(importer).replace(/\\/g, "/");
  return normalized.includes("/packages/core/dist/");
}

function rendererScopedAtAlias(): Plugin {
  return {
    name: "renderer-scoped-at-alias",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!source.startsWith("@/")) {
        return null;
      }
      const subpath = source.slice(2);
      const root = isCoreDistModule(importer) ? coreDistRoot : rendererRoot;
      return this.resolve(path.join(root, subpath), importer, {
        ...options,
        skipSelf: true,
      });
    },
  };
}

export default defineConfig({
  root: rendererRoot,
  base: "./",
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "../../assets"),
      "node:crypto": path.resolve(__dirname, "renderer/shims/node-crypto.ts"),
    },
  },
  plugins: [rendererScopedAtAlias(), react()],
  build: {
    outDir: path.join(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.join(__dirname, "../..")],
    },
  },
});
