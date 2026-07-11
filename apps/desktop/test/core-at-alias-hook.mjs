/**
 * Resolve `@/` imports from core dist when tsc-alias was not applied.
 * Mirrors renderer-scoped-at-alias in vite.config.ts for Node test runs.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coreDistRoot = path.resolve(__dirname, "../../../packages/core/dist");

function isCoreDistModule(importer) {
  if (importer == null) {
    return false;
  }
  const normalized = fileURLToPath(importer).replace(/\\/g, "/");
  return normalized.includes("/packages/core/dist/");
}

function resolveCoreDistFile(subpath) {
  const base = path.join(coreDistRoot, subpath);
  const candidates = [
    base,
    `${base}.js`,
    `${base}.ts`,
    path.join(base, "index.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }
  return pathToFileURL(`${base}.js`).href;
}

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) {
    return nextResolve(specifier, context);
  }
  if (!isCoreDistModule(context.parentURL)) {
    return nextResolve(specifier, context);
  }
  const subpath = specifier.slice(2);
  return {
    shortCircuit: true,
    url: resolveCoreDistFile(subpath),
  };
}
