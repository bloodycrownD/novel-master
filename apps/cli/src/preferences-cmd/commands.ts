/**
 * `nm preferences` subcommands.
 *
 * @module preferences-cmd/commands
 */

import type { PersistentPreferences } from "@novel-master/core";
import {
  PREF_KEY_CHAT_LLM_STREAM,
  PREF_KEY_SESSION_FS_VERSION_CHECK,
} from "@novel-master/core";
import { PreferencesError } from "@novel-master/core";
import { parseCliArgs } from "../vfs/parse-args.js";

const KNOWN_KEYS = [
  PREF_KEY_SESSION_FS_VERSION_CHECK,
  PREF_KEY_CHAT_LLM_STREAM,
] as const;

type KnownKey = (typeof KNOWN_KEYS)[number];

function isKnownKey(key: string): key is KnownKey {
  return (KNOWN_KEYS as readonly string[]).includes(key);
}

function usageGet(): string {
  return `Usage: nm preferences get <${KNOWN_KEYS.join("|")}>`;
}

function usageSet(): string {
  return `Usage: nm preferences set <${KNOWN_KEYS.join("|")}> <value>`;
}

function usageReset(): string {
  return `Usage: nm preferences reset <${KNOWN_KEYS.join("|")}>`;
}

function parseBooleanArg(raw: string, key: string): boolean {
  if (raw !== "true" && raw !== "false") {
    throw new Error(`Usage: nm preferences set ${key} <true|false>`);
  }
  return raw === "true";
}

async function getValue(
  preferences: PersistentPreferences,
  key: KnownKey,
): Promise<string> {
  switch (key) {
    case PREF_KEY_SESSION_FS_VERSION_CHECK: {
      const enabled = await preferences.getSessionFsVersionCheck();
      return enabled ? "true" : "false";
    }
    case PREF_KEY_CHAT_LLM_STREAM: {
      const enabled = await preferences.getLlmStreamEnabled();
      return enabled ? "true" : "false";
    }
  }
}

async function setValue(
  preferences: PersistentPreferences,
  key: KnownKey,
  raw: string,
): Promise<void> {
  try {
    switch (key) {
      case PREF_KEY_SESSION_FS_VERSION_CHECK:
        await preferences.setSessionFsVersionCheck(parseBooleanArg(raw, key));
        return;
      case PREF_KEY_CHAT_LLM_STREAM:
        await preferences.setLlmStreamEnabled(parseBooleanArg(raw, key));
        return;
    }
  } catch (error) {
    if (error instanceof PreferencesError && error.code === "INVALID_VALUE") {
      throw new Error(error.message);
    }
    throw error;
  }
}

async function resetValue(
  preferences: PersistentPreferences,
  key: KnownKey,
): Promise<void> {
  switch (key) {
    case PREF_KEY_SESSION_FS_VERSION_CHECK:
      await preferences.resetSessionFsVersionCheck();
      return;
    case PREF_KEY_CHAT_LLM_STREAM:
      await preferences.resetLlmStreamEnabled();
      return;
  }
}

export async function runPreferences(
  preferences: PersistentPreferences,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { positional } = parseCliArgs(args);

  switch (subcommand) {
    case "get": {
      const key = positional[0];
      if (!key || !isKnownKey(key)) {
        throw new Error(usageGet());
      }
      console.log(await getValue(preferences, key));
      return;
    }
    case "set": {
      const key = positional[0];
      const raw = positional[1];
      if (!key || !isKnownKey(key) || raw === undefined) {
        throw new Error(usageSet());
      }
      await setValue(preferences, key, raw);
      return;
    }
    case "reset": {
      const key = positional[0];
      if (!key || !isKnownKey(key)) {
        throw new Error(usageReset());
      }
      await resetValue(preferences, key);
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
        `Usage: nm preferences <get|set|reset|list> <${KNOWN_KEYS.join("|")}> ...`,
      );
  }
}
