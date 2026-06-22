import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testNativeSqlite = pathToFileURL(
  path.join(__dirname, "..", ".test-native", "better-sqlite3", "lib", "index.js"),
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "better-sqlite3") {
    return {
      shortCircuit: true,
      url: testNativeSqlite,
    };
  }
  return nextResolve(specifier, context);
}
