/**
 * PersistentPreferences IPC — 布尔开关全表（feature → 端口读写 + 通道）收敛。
 *
 * 新增开关只加表内一行；get/set 两个泛型 handler 复用同一套 runtime 装配
 * 与 Result 转码。
 */
import { IPC_CHANNELS, type IpcChannel, type IpcResult } from "../../../../shared/ipc-types.js";
import type { AppError } from "@novel-master/core/errors";
import type { PersistentPreferences } from "@novel-master/core";
import { Result } from "@novel-master/core/errors";
import { DesktopRuntimeSingleton } from "../../runtime/desktop-runtime-singleton.js";
import { IpcResults } from "../ipc-result.js";

type PreferenceFeatureSpec = {
  readonly getChannel: IpcChannel;
  readonly setChannel: IpcChannel;
  readonly read: (preferences: PersistentPreferences) => Promise<Result<boolean, AppError>>;
  readonly write: (preferences: PersistentPreferences, enabled: boolean) => Promise<void>;
};

/** 布尔偏好 feature 表：桌面端与 Core 端口的三对开关对齐（含 VFS 统一 tool turn）。 */
/** feature 键显式列出（导出表注解成可命名类型——推断类型的 read/write 返回值引用 core dist 的窄码 Result，声明发射不可命名 TS2883）。 */
export type PreferenceFeature = "llmStream" | "subagentStream" | "thinkingContext" | "userVfsUnifiedToolTurn";

export const PREFERENCE_FEATURES: Record<PreferenceFeature, PreferenceFeatureSpec> = {
  llmStream: {
    getChannel: IPC_CHANNELS.PREFERENCES_GET_LLM_STREAM,
    setChannel: IPC_CHANNELS.PREFERENCES_SET_LLM_STREAM,
    read: (preferences) => preferences.getLlmStreamEnabled(),
    write: (preferences, enabled) => preferences.setLlmStreamEnabled(enabled),
  },
  subagentStream: {
    getChannel: IPC_CHANNELS.PREFERENCES_GET_SUBAGENT_STREAM,
    setChannel: IPC_CHANNELS.PREFERENCES_SET_SUBAGENT_STREAM,
    read: (preferences) => preferences.getSubagentStreamEnabled(),
    write: (preferences, enabled) => preferences.setSubagentStreamEnabled(enabled),
  },
  thinkingContext: {
    getChannel: IPC_CHANNELS.PREFERENCES_GET_THINKING_CONTEXT,
    setChannel: IPC_CHANNELS.PREFERENCES_SET_THINKING_CONTEXT,
    read: (preferences) => preferences.getThinkingContextEnabled(),
    write: (preferences, enabled) => preferences.setThinkingContextEnabled(enabled),
  },
  userVfsUnifiedToolTurn: {
    getChannel: IPC_CHANNELS.PREFERENCES_GET_USER_VFS_UNIFIED_TOOL_TURN,
    setChannel: IPC_CHANNELS.PREFERENCES_SET_USER_VFS_UNIFIED_TOOL_TURN,
    read: (preferences) => preferences.getUserVfsUnifiedToolTurn(),
    write: (preferences, enabled) => preferences.setUserVfsUnifiedToolTurn(enabled),
  },
};

export const Preferences = {
  /** nm-style: keep-public — IPC handler 模块入口：registry 单点注册 + 桌面测试直调，runtime 装配与 Result 转码归属本模块。 */
  get(feature: PreferenceFeature): Promise<IpcResult<boolean>> {
    return IpcResults.from(async () => {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return Result.err(built.error);
      return PREFERENCE_FEATURES[feature].read(built.value.preferences);
    });
  },

  /** nm-style: keep-public — 同上：set 入口由 registry 注册（bindBool），策略在本模块而非注册表。 */
  async set(feature: PreferenceFeature, enabled: boolean): Promise<IpcResult<void>> {
    return IpcResults.from(async () => {
      const built = await DesktopRuntimeSingleton.get();
      // runtime 装配的已知失败沿 Result 上行（错误通道迁移七期），就地短路。
      if (!built.ok) return Result.err(built.error);
      await PREFERENCE_FEATURES[feature].write(built.value.preferences, enabled);
      return Result.ok(undefined);
    });
  },
} as const;
