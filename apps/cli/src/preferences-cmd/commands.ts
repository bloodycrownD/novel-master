/**
 * `nm preferences` subcommands.
 *
 * @module preferences-cmd/commands
 */

import type { PersistentPreferences } from "@novel-master/core";
import {
  PREF_KEY_CHAT_LLM_STREAM,
  PREF_KEY_CHAT_SUBAGENT_STREAM,
  PREF_KEY_CHAT_THINKING_CONTEXT,
  PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN,
} from "@novel-master/core";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../cli-errors.js";
import { parseCliArgs } from "../vfs/parse-args.js";

const KNOWN_KEYS = [
  PREF_KEY_CHAT_LLM_STREAM,
  PREF_KEY_CHAT_SUBAGENT_STREAM,
  PREF_KEY_CHAT_THINKING_CONTEXT,
  PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN,
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
): Promise<Result<string, AppError>> {
  switch (key) {
    case PREF_KEY_CHAT_LLM_STREAM: {
      const enabled = await preferences.getLlmStreamEnabled();
      if (!enabled.ok) return Result.err(enabled.error);
      return Result.ok(enabled.value ? "true" : "false");
    }
    case PREF_KEY_CHAT_SUBAGENT_STREAM: {
      const enabled = await preferences.getSubagentStreamEnabled();
      if (!enabled.ok) return Result.err(enabled.error);
      return Result.ok(enabled.value ? "true" : "false");
    }
    case PREF_KEY_CHAT_THINKING_CONTEXT: {
      const enabled = await preferences.getThinkingContextEnabled();
      if (!enabled.ok) return Result.err(enabled.error);
      return Result.ok(enabled.value ? "true" : "false");
    }
    case PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN: {
      const vfsEnabled = await preferences.getUserVfsUnifiedToolTurn();
      if (!vfsEnabled.ok) return Result.err(vfsEnabled.error);
      return Result.ok(vfsEnabled.value ? "true" : "false");
    }
  }
}

async function setValue(
  preferences: PersistentPreferences,
  key: KnownKey,
  raw: string,
): Promise<void> {
  // PREFERENCES_INVALID_VALUE 无 messageKey（码表 109500），formatCliError 直出
  // `error.message`——原 catch 转手 `new Error(error.message)` 与直接冒泡输出逐字
  // 一致且丢 code，删除（错误通道迁移三期）。
  switch (key) {
    case PREF_KEY_CHAT_LLM_STREAM:
      await preferences.setLlmStreamEnabled(parseBooleanArg(raw, key));
      return;
    case PREF_KEY_CHAT_SUBAGENT_STREAM:
      await preferences.setSubagentStreamEnabled(parseBooleanArg(raw, key));
      return;
    case PREF_KEY_CHAT_THINKING_CONTEXT:
      await preferences.setThinkingContextEnabled(parseBooleanArg(raw, key));
      return;
    case PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN:
      await preferences.setUserVfsUnifiedToolTurn(parseBooleanArg(raw, key));
      return;
  }
}

async function resetValue(
  preferences: PersistentPreferences,
  key: KnownKey,
): Promise<Result<void, AppError>> {
  switch (key) {
    case PREF_KEY_CHAT_LLM_STREAM: {
      const reset = await preferences.resetLlmStreamEnabled();
      if (!reset.ok) return Result.err(reset.error);
      return RESULT_OK;
    }
    case PREF_KEY_CHAT_SUBAGENT_STREAM: {
      const reset = await preferences.resetSubagentStreamEnabled();
      if (!reset.ok) return Result.err(reset.error);
      return RESULT_OK;
    }
    case PREF_KEY_CHAT_THINKING_CONTEXT: {
      const reset = await preferences.resetThinkingContextEnabled();
      if (!reset.ok) return Result.err(reset.error);
      return RESULT_OK;
    }
    case PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN: {
      const reset = await preferences.resetUserVfsUnifiedToolTurn();
      if (!reset.ok) return Result.err(reset.error);
      return RESULT_OK;
    }
  }
}

export async function runPreferences(
  preferences: PersistentPreferences,
  subcommand: string,
  args: readonly string[],
): Promise<Result<void, AppError>> {
  const { positional } = parseCliArgs(args);

  switch (subcommand) {
    case "get": {
      const key = positional[0];
      if (!key || !isKnownKey(key)) {
        throw new Error(usageGet());
      }
      const value = await getValue(preferences, key);
      if (!value.ok) return Result.err(value.error);
      console.log(value.value);
      return RESULT_OK;
    }
    case "set": {
      const key = positional[0];
      const raw = positional[1];
      if (!key || !isKnownKey(key) || raw === undefined) {
        throw new Error(usageSet());
      }
      await setValue(preferences, key, raw);
      return RESULT_OK;
    }
    case "reset": {
      const key = positional[0];
      if (!key || !isKnownKey(key)) {
        throw new Error(usageReset());
      }
      const reset = await resetValue(preferences, key);
      if (!reset.ok) return Result.err(reset.error);
      return RESULT_OK;
    }
    case "list": {
      const entries = await preferences.list();
      for (const { key, value } of entries) {
        console.log(`${key}=${value}`);
      }
      return RESULT_OK;
    }
    default:
      throw new Error(
        `Usage: nm preferences <get|set|reset|list> <${KNOWN_KEYS.join("|")}> ...`,
      );
  }
}
