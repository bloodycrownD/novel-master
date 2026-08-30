/**
 * Agent Prompt 三区布局模型（system + persist + dynamic）。
 *
 * @module domain/prompt/model/agent-prompt-layout
 */

import type { PromptBlockLifecycle } from "./prompt-block.js";

/** persist 区文本块（user | assistant）。 */
export type PersistTextPromptBlock = {
  readonly name: string;
  readonly type: "text";
  readonly role: "user" | "assistant";
  readonly content: string;
};

/**
 * 编辑器/UI 用旧 worktree 块形状（域 layout 已废弃；读入 strip，写出 omit）。
 * @deprecated 使用 {@link AgentPromptLayout.workplace} 非空 string。
 */
export type PersistWorktreePromptBlock = {
  readonly name: string;
  readonly type: "worktree";
  /** wire 缺省时视为 user。 */
  readonly role?: "user" | "assistant";
};

/** 编辑器 persist 块（含过渡态 worktree）；域 {@link AgentPromptLayout.persist} 仅 text。 */
export type EditorPersistPromptBlock =
  | PersistTextPromptBlock
  | PersistWorktreePromptBlock;

/** @deprecated 域 persist 仅 text；请用 {@link PersistTextPromptBlock}。 */
export type PersistPromptBlock = EditorPersistPromptBlock;

/** dynamic 区文本块（允许宏与 lifecycle）。 */
export type DynamicPromptBlock = {
  readonly name: string;
  readonly type: "text";
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly lifecycle?: PromptBlockLifecycle;
};

/**
 * wire `workplace: true` 读入后的兼容助手确认语
 *（与现网 tool-turn bridge 字面一致，但常驻路径语义独立，勿再 import bridge 常量）。
 */
export const WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT = "【done】";

/** Agent 编辑器首次开启常驻工作区时的默认助手确认语。 */
export const DEFAULT_WORKPLACE_ASSISTANT_TEXT = "我看到工作区了";

/** 技能索引段默认前缀语（`prompts.skillsPrefix` 缺省/空时使用）。 */
export const DEFAULT_SKILLS_INDEX_PREFIX =
  "当前可用技能（每条为 名称：描述（来源域），正文经 skill 工具按需读取）：";

/**
 * 布局是否启用常驻工作区（开 = 非空 string）。
 */
export function layoutHasWorkplace(
  layout: Pick<AgentPromptLayout, "workplace">
): boolean {
  return typeof layout.workplace === "string" && layout.workplace.length > 0;
}

/**
 * 布局是否带自定义附加信息（开 = trim 后非空 string；缺省 = 关）。
 */
export function layoutHasCustomAttach(
  layout: Pick<AgentPromptLayout, "customAttach">
): boolean {
  return (
    typeof layout.customAttach === "string" &&
    layout.customAttach.trim().length > 0
  );
}

/**
 * Agent Prompt 布局（替代扁平 {@link PromptBlock}[]）。
 * chat 为运行时槽位，不出现在配置中。
 */
export interface AgentPromptLayout {
  /** 可选单段 system；映射到 API `system` 字段。 */
  readonly system?: string;
  /** 持久区开关；缺省视为 `false`（组装跳过 persist）。 */
  readonly persistEnabled?: boolean;
  /** 动态区开关；缺省视为 `false`（组装跳过 dynamic）。 */
  readonly dynamicEnabled?: boolean;
  /**
   * 常驻工作区助手确认语；缺省 = 关；开 = 非空 string
   *（wire 可读 `true` → {@link WORKPLACE_TRUE_COMPAT_ASSISTANT_TEXT}）。
   */
  readonly workplace?: string;
  /**
   * 自定义附加信息（运行时注入 `<extra-info>` 纯文本块）；缺省 = 关；
   * 开 = trim 后非空 string（空则静默省略）。
   */
  readonly customAttach?: string;
  /**
   * 技能能力总开关；缺省视为 `true`（注入技能索引 + 注册 skill 工具）。
   * `false` = 不注入索引且不注册 skill 工具（resolveAgentToolRegistry 摘除，
   * D4 联动随之生效）；用户显式 `$` 引用不受影响。
   */
  readonly skillsEnabled?: boolean;
  /**
   * 技能索引前缀语；缺省/空 = {@link DEFAULT_SKILLS_INDEX_PREFIX}。
   * 仅 `skillsEnabled !== false` 时有意义。
   */
  readonly skillsPrefix?: string;
  /** 持久区文本块（不含 worktree 块）。 */
  readonly persist: readonly PersistTextPromptBlock[];
  readonly dynamic: readonly DynamicPromptBlock[];
}
