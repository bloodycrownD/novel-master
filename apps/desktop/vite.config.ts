/**
 * Vite config for the sandboxed Electron renderer (React SPA).
 * Output lands in dist/renderer for main process loadFile in production.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(__dirname, "renderer"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.join(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
