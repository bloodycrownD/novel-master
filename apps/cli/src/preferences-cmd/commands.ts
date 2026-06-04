/**
 * `nm preferences` subcommands.
 *
 * @module preferences-cmd/commands
 */

import {
  TOKEN_COUNTER_MODE_PREF_KEY,
  type PersistentPreferences,
} from "@novel-master/core";
import { parseCliArgs } from "../vfs/parse-args.js";

const KEY_VERSION_CHECK = "session-fs.versionCheck";

export async function runPreferences(
  preferences: PersistentPreferences,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { positional } = parseCliArgs(args);

  switch (subcommand) {
    case "get": {
      const key = positional[0];
      if (key === KEY_VERSION_CHECK) {
        const enabled = await preferences.getSessionFsVersionCheck();
        console.log(enabled ? "true" : "false");
        return;
      }
      if (key === TOKEN_COUNTER_MODE_PREF_KEY) {
        const raw = await preferences.getPreference(key);
        console.log(raw ?? "auto");
        return;
      }
      throw new Error(
        `Usage: nm preferences get <${KEY_VERSION_CHECK}|${TOKEN_COUNTER_MODE_PREF_KEY}>`,
      );
    }
    case "set": {
      const key = positional[0];
      const raw = positional[1];
      if (key === KEY_VERSION_CHECK) {
        if (raw !== "true" && raw !== "false") {
          throw new Error(
            `Usage: nm preferences set ${KEY_VERSION_CHECK} <true|false>`,
          );
        }
        await preferences.setSessionFsVersionCheck(raw === "true");
        return;
      }
      if (key === TOKEN_COUNTER_MODE_PREF_KEY) {
        if (typeof raw !== "string" || raw.length === 0) {
          throw new Error(
            `Usage: nm preferences set ${TOKEN_COUNTER_MODE_PREF_KEY} <auto|heuristic|claude|...>`,
          );
        }
        await preferences.setPreference(key, raw);
        return;
      }
      throw new Error(
        `Usage: nm preferences set <${KEY_VERSION_CHECK}|${TOKEN_COUNTER_MODE_PREF_KEY}> <value>`,
      );
    }
    case "reset": {
      const key = positional[0];
      if (key !== KEY_VERSION_CHECK) {
        throw new Error(`Usage: nm preferences reset ${KEY_VERSION_CHECK}`);
      }
      await preferences.resetSessionFsVersionCheck();
      return;
    }
    case "list": {
      const entries = await preferences.list();
      for (const { key, value } of entries) {
        console.log(`${key}=${value}`);
      }
      return;
    }
    default:
      throw new Error(
        `Usage: nm preferences <get|set|reset|list> ${KEY_VERSION_CHECK}|${TOKEN_COUNTER_MODE_PREF_KEY} ...`,
      );
  }
}
