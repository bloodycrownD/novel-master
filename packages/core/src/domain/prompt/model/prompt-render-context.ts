/**
 * Prompt assembly context types (domain layer).
 *
 * @module domain/prompt/model/prompt-render-context
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";

/** 技能索引条目（生产方预解析；render-prompt 只做纯拼装，无 IO）。 */
export interface PromptSkillIndexEntry {
  readonly name: string;
  readonly description: string;
  readonly domain: "global" | "project";
}

/** workplace 结构化文件条目（`assembleWorkplaceDisplay` 顺产，预览侧二级卡数据源）。 */
export interface PromptWorkplaceFileEntry {
  /** VFS 逻辑路径（规则快照条目原值）。 */
  readonly path: string;
  /** 展示档（与 `WorkplaceDisplayStatus` 同值：`full` / `header` / `filename`）。 */
  readonly display: "full" | "header" | "filename";
  /** 块内正文（`N|行` 行号格式；header 档为 front-matter 行）。 */
  readonly body: string;
}

/** Workplace + 会话消息 + VFS 上下文（dynamic 宏展开）。 */
export interface PromptRenderContext {
  readonly workplaceDisplay: string;
  readonly messages: readonly ChatMessage[];
  /** Defaults to `new Date()` when omitted (tests inject a fixed time). */
  readonly now?: Date;
  /** Workplace 服务，供 `{{$filetree}}` 实时渲染。 */
  readonly workplace?: WorkplaceService;
  /** 回合快照的 `{{$filetree}}` 预渲染结果；传入时优先于 {@link workplace} 实时渲染。 */
  readonly filetree?: string;
  /** Session VFS（其他调用方仍可传；`{{$filetree}}` 不再读取）。 */
  readonly vfs?: VfsService;
  /**
   * 生效技能索引（名称 + 描述 + 来源域），由生产方按 projectId 预算
   * （`SkillService.effectiveSkills`）；空/缺省不产生技能索引段。
   */
  readonly skillsIndex?: readonly PromptSkillIndexEntry[];
  /**
   * workplace 的**结构化文件清单**（`assembleWorkplaceDisplay` 顺产）：
   * 预览侧 workplace 二级卡的数据源——不从 `workplaceDisplay` 展示串反解
   * （用户拍板：从 session kkv 规则快照源头直通更干净）。缺省/空时预览侧
   * workplace 段退普通文本卡。
   */
  readonly workplaceFiles?: readonly PromptWorkplaceFileEntry[];
  /**
   * workplaceDisplay 的**廉价内容指纹**（`assembleWorkplaceDisplay` 产出，
   * `path|status|mtimeMs|bodyLen` 列表 join，2026-09-30；体量段为 r4-core-4
   * 所补，挡「mtime 同、正文异」的指纹假同）：token 估算读数的记忆缓存
   * 用它识别「前缀没变」，免掉对组装产物串本身的序列化/哈希。缺省视为
   * 「无指纹」——记忆缓存按 miss 处理（不缓存，行为与无此字段前一致）。
   */
  readonly workplaceFingerprint?: string;
}

/** Structured input for model request services. */
export interface PromptLlmInput {
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
}
