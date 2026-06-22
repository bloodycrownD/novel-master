import { existsSync } from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

register("./electron-hook.mjs", import.meta.url);

const testNativeSqlite = path.join(__dirname, "..", ".test-native", "better-sqlite3");
if (existsSync(path.join(testNativeSqlite, "package.json"))) {
  register("./better-sqlite3-hook.mjs", import.meta.url);
}
