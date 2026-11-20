/**
 * `nm preferences` subcommands.
 *
 * @module preferences-cmd/commands
 */

import type { PersistentPreferences } from "@novel-master/core";
import { PREF_KEY_CHAT_LLM_STREAM, PREF_KEY_CHAT_SUBAGENT_STREAM, PREF_KEY_CHAT_THINKING_CONTEXT, PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN } from "@novel-master/core";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../cli-errors.js";
import { parseCliArgs } from "../vfs/parse-args.js";

const KNOWN_KEYS = [PREF_KEY_CHAT_LLM_STREAM, PREF_KEY_CHAT_SUBAGENT_STREAM, PREF_KEY_CHAT_THINKING_CONTEXT, PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN] as const;

type KnownKey = (typeof KNOWN_KEYS)[number];

// nm-style: keep-local — 类型守卫把 string 窄化成 KnownKey，三处调用共享；内联会丢掉窄化、迫使每个调用点补断言。
function isKnownKey(key: string): key is KnownKey {
  return (KNOWN_KEYS as readonly string[]).includes(key);
}

function parseBooleanArg(raw: string, key: string): boolean {
  if (raw !== "true" && raw !== "false") {
    throw new Error(`Usage: nm preferences set ${key} <true|false>`);
  }
  return raw === "true";
}

export async function runPreferences(preferences: PersistentPreferences, subcommand: string, args: readonly string[]): Promise<Result<void, AppError>> {
  const { positional } = parseCliArgs(args);

  switch (subcommand) {
    case "get": {
      const key = positional[0];
      if (!key || !isKnownKey(key)) throw new Error(`Usage: nm preferences get <${KNOWN_KEYS.join("|")}>`);
      let value: string;
      switch (key) {
        case PREF_KEY_CHAT_LLM_STREAM: {
          const enabled = await preferences.getLlmStreamEnabled();
          if (!enabled.ok) return Result.err(enabled.error);
          value = enabled.value ? "true" : "false";
          break;
        }
        case PREF_KEY_CHAT_SUBAGENT_STREAM: {
          const enabled = await preferences.getSubagentStreamEnabled();
          if (!enabled.ok) return Result.err(enabled.error);
          value = enabled.value ? "true" : "false";
          break;
        }
        case PREF_KEY_CHAT_THINKING_CONTEXT: {
          const enabled = await preferences.getThinkingContextEnabled();
          if (!enabled.ok) return Result.err(enabled.error);
          value = enabled.value ? "true" : "false";
          break;
        }
        case PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN: {
          const vfsEnabled = await preferences.getUserVfsUnifiedToolTurn();
          if (!vfsEnabled.ok) return Result.err(vfsEnabled.error);
          value = vfsEnabled.value ? "true" : "false";
          break;
        }
      }
      console.log(value);
      return RESULT_OK;
    }
    case "set": {
      const key = positional[0];
      const raw = positional[1];
      if (!key || !isKnownKey(key) || raw === undefined) throw new Error(`Usage: nm preferences set <${KNOWN_KEYS.join("|")}> <value>`);
      // PREFERENCES_INVALID_VALUE 无 messageKey（码表 109500），formatCliError 直出
      // `error.message`——原 catch 转手 `new Error(error.message)` 与直接冒泡输出逐字
      // 一致且丢 code，删除（错误通道迁移三期）。
      switch (key) {
        case PREF_KEY_CHAT_LLM_STREAM:
          await preferences.setLlmStreamEnabled(parseBooleanArg(raw, key));
          break;
        case PREF_KEY_CHAT_SUBAGENT_STREAM:
          await preferences.setSubagentStreamEnabled(parseBooleanArg(raw, key));
          break;
        case PREF_KEY_CHAT_THINKING_CONTEXT:
          await preferences.setThinkingContextEnabled(parseBooleanArg(raw, key));
          break;
        case PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN:
          await preferences.setUserVfsUnifiedToolTurn(parseBooleanArg(raw, key));
          break;
      }
      return RESULT_OK;
    }
    case "reset": {
      const key = positional[0];
      if (!key || !isKnownKey(key)) throw new Error(`Usage: nm preferences reset <${KNOWN_KEYS.join("|")}>`);
      switch (key) {
        case PREF_KEY_CHAT_LLM_STREAM: {
          const reset = await preferences.resetLlmStreamEnabled();
          if (!reset.ok) return Result.err(reset.error);
          break;
        }
        case PREF_KEY_CHAT_SUBAGENT_STREAM: {
          const reset = await preferences.resetSubagentStreamEnabled();
          if (!reset.ok) return Result.err(reset.error);
          break;
        }
        case PREF_KEY_CHAT_THINKING_CONTEXT: {
          const reset = await preferences.resetThinkingContextEnabled();
          if (!reset.ok) return Result.err(reset.error);
          break;
        }
        case PREF_KEY_VFS_USER_VFS_UNIFIED_TOOL_TURN: {
          const reset = await preferences.resetUserVfsUnifiedToolTurn();
          if (!reset.ok) return Result.err(reset.error);
          break;
        }
      }
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
      throw new Error(`Usage: nm preferences <get|set|reset|list> <${KNOWN_KEYS.join("|")}> ...`);
  }
}
