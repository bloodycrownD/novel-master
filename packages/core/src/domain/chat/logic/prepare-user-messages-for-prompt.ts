/**
 * 异步 hydrate + wrap 用户消息附件；LLM / 预览 / token 的唯一拼装入口。
 *
 * 按可见序共享「已出现路径」：常驻前缀 S0 → attach → workplace（历史只读兼容）；user_ops 不参与。
 * 文件 attach 非首次 → alreadyReferenced 短提示；workplace 非首次 → content 空；目录每次拼树仍计 seen。
 *
 * S0 是**两个**集合（spec G6 双读）：`seenPaths` 只收 full 档（attach 去重初值），
 * `workplaceSeenPaths` 收全量可见档（workplace 省略判定，缺省回落 `seenPaths`）。
 * 后者只在 workplace 判定里被读、从不写共享 `seen`，故 attach 抢先与跨消息抑制
 * 的运行期语义分毫未动。
 * skillAttach（`$技能名`）走 `skill:{name}` 命名空间 seen：首次读生效副本 SKILL.md 全文
 * （跨域读不经 session file_cache，直接 SkillService）；不存在 → 一行提示且不写 seen（自愈）；
 * 常驻索引不计入「已出现」，被压缩/置位重置随可见窗口自动继承。
 * 增量统一为 `<action name="userAttach|workplaceChange|…">` + JSON（行号正文；无 mtime/createdAt）。
 * `runtime.extraInfo`（来自 agent 配置 customAttach）非空时，仅对本次请求里最新一条
 * 非隐藏 user 输入消息生效——wrap 阶段在 `</user-ops>` 后注入 `<extra-info>` 纯文本块；
 * 历史 user 消息不再注入（与 dynamic 区 once 语义不同，独立实现）。
 *
 * @module domain/chat/logic/prepare-user-messages-for-prompt
 */

import {
  RULE_SNAPSHOT_CANON_KEY,
  SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import { loadOrFillFileCache } from "@/domain/workplace/logic/load-or-fill-file-cache.js";
import { parseRuleSnapshotJson } from "@/domain/workplace/logic/rule-snapshot-codec.js";
import { renderFileBlockBody } from "@/domain/workplace/logic/workplace-display.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { VfsRevisionRepository } from "@/domain/vfs/repositories/vfs-revision.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { messageBodyTextFromContent } from "../content/message-body-text.js";
import { textBlocks } from "../content/text-blocks.js";
import type { ChatMessage } from "../model/message.js";
import type { MessageAttachment } from "../model/message-attachment.schema.js";
import {
  BINARY_ATTACH_NOTE,
  OVERSIZED_ATTACH_NOTE,
  createAttachBudget,
  type AttachBudget,
} from "./attach-budget.js";
import {
  isBinaryAttachPath,
  isImageAttachPath,
} from "./attach-binary-heuristic.js";
import { isUserInputMessage } from "./message-content-helpers.js";
import { hydrateToolResultsForPrompt } from "./hydrate-tool-results-for-prompt.js";
import {
  buildAlreadyReferencedActionXml,
  buildAttachmentActionXml,
  buildDirTreeActionXml,
  buildFileRefActionXml,
} from "./build-attachment-action-xml.js";
import {
  createPromptPathSeenSet,
  tryNormalizePromptSeenPath,
} from "./prompt-path-seen.js";
import { skillSeenKey } from "./scan-skill-attachments.js";

/** 与 `domain/tool/builtin/skill-tool.ts` 注册名同字符串（方向 B 扫描用）。 */
const SKILL_TOOL_NAME = "skill";
import { renderDirAttachTree } from "./render-dir-attach-tree.js";
import { wrapUserMessageForLlm } from "./wrap-user-message-for-llm.js";
import { expandDynamicMacros } from "@/domain/prompt/logic/expand-dynamic-macros.js";
import type { WorkplaceService } from "@/service/workplace/workplace.port.js";
import type { SkillService } from "@/service/skills/skills.port.js";

/** {@link prepareUserMessagesForPrompt} 运行时依赖与可选初始 seen。 */
export interface PrepareUserMessagesForPromptRuntime {
  readonly sessionId: string;
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
  /**
   * 常驻前缀 path 集合 S0（已或未规范化均可）；prepare 内再规范化后写入 seen。
   * 通常来自 `assembleWorkplaceDisplay().prefixPaths`。
   *
   * v1.5.30 起**只收 `status === "full"` 的条目**（assemble 侧已收窄）——只有真正
   * 全文注入提示词的路径才有资格抑制 attach 的全文。
   */
  readonly seenPaths?: readonly string[];
  /**
   * 工作区「已展示」path 集合（通常来自 `assembleWorkplaceDisplay().visiblePaths`，
   * 含 full / header / filename 三档）。
   *
   * 只喂 `hydrateWorkplaceWithSeen` 的**省略判定**，且**不写入共享 `seen`**——
   * 共享 seen 的运行期语义（attach 抢先、跨消息抑制）完全不动。缺省回落
   * {@link seenPaths}（旧调用方零变化）。
   */
  readonly workplaceSeenPaths?: readonly string[];
  /**
   * 自定义附加信息（agent 配置 customAttach，**未展开宏的原文本**）；
   * trim 非空时在 prepare 入口经 {@link expandDynamicMacros} 展开宏后，由 wrap 阶段注入 `<extra-info>` 块。
   */
  readonly extraInfo?: string;
  /** 宏展开所需的当前时间（默认取 new Date()）。 */
  readonly now?: Date;
  /** 宏展开所需的 workplace 服务（用于 $filetree 实时渲染）。 */
  readonly workplace?: WorkplaceService;
  /** 回合快照的 `{{$filetree}}` 预渲染结果；传入时优先于实时渲染。 */
  readonly filetree?: string;
  /**
   * 技能服务（skillAttach 附件 hydrate 用）。缺省时 skillAttach 附件原样带过
   * （不读盘、不写 seen），调用方接线后自动生效。
   */
  readonly skills?: SkillService;
  /** skillAttach 存在性判定与生效副本读取的解析上下文。 */
  readonly projectId?: string;
  /**
   * 存量 contentRef 块的**极简兜底** hydrate 所需的 revision 仓库。
   *
   * v1.5.30 unref 回迁后写侧不再产 `contentRef`；本依赖只为 v1.5.29 装机
   * 窗口写入的存量行取明文回填（按 `(entryId, version)`）。未注入时兜底
   * 路径不抛错，改填错误占位 JSON 并 `console.warn`（装配缺口信号保留）。
   */
  readonly revisionRepo?: VfsRevisionRepository;
}

async function resolveWorkplaceStatus(
  path: string,
  runtime: PrepareUserMessagesForPromptRuntime
): Promise<WorkplaceDisplayStatus> {
  const raw = await runtime.sessionKkv.get(
    runtime.sessionId,
    SESSION_KKV_DOMAIN_RULE_SNAPSHOT,
    RULE_SNAPSHOT_CANON_KEY
  );
  if (raw == null || raw === "") {
    return "full";
  }
  const entries = parseRuleSnapshotJson(raw);
  if (entries == null) {
    return "full";
  }
  const hit = entries.find((e) => e.path === path);
  return hit?.status ?? "full";
}

function resolveAttachFileStatus(
  path: string,
  type: MessageAttachment["type"]
): WorkplaceDisplayStatus {
  if (type === "image" || isBinaryAttachPath(path) || isImageAttachPath(path)) {
    return "filename";
  }
  return "full";
}

function isBinaryOrImageAttach(attachment: MessageAttachment): boolean {
  if (attachment.type === "image" || attachment.type === "dir") {
    return attachment.type === "image";
  }
  const path = attachment.path ?? "";
  return isBinaryAttachPath(path) || isImageAttachPath(path);
}

/** {@link fileRefAction} 的可选正文口径开关。 */
interface FileRefActionOpts {
  /**
   * 二进制 / 图片文案（{@link BINARY_ATTACH_NOTE}）：传入则 content 直用文案，
   * **不再走行号正文**（attach 侧 filename 档不再是 `1|basename`）。
   * 仅 attach 源传入——workplace 源豁免（目录规则的 `1|basename` 原样保留）。
   */
  readonly noteText?: string;
  /**
   * 内层正文已是展示正文（旧 `<file>` 外壳剥出的行号块），**勿再 contentLines**。
   */
  readonly bodyIsRendered?: boolean;
  /** 超预算降级：绕过 renderFileBlockBody，display 强制 `filename`。 */
  readonly oversized?: boolean;
}

/**
 * 文件附件的唯一 action XML 出口：正文口径（行号正文 / 二进制文案 / 超限降级）
 * 全部集中于此，避免各分支各写一份 `buildFileRefActionXml` 走形。
 */
function fileRefAction(
  source: "attach" | "workplace",
  logicalPath: string,
  display: WorkplaceDisplayStatus,
  rawContent: string,
  opts?: FileRefActionOpts
): string {
  const action = source === "workplace" ? ("workplaceChange" as const) : ("userAttach" as const);
  // ⚠️ 下面两个分支**互斥且顺序敏感**：`noteText` 先于 `oversized` 命中。
  // 互斥依据（改任一侧判据前先读这段）：
  // `noteText` 只在 attach 源的 `filename` 档出现，而 `filename` 档由
  // {@link resolveAttachFileStatus} 对 image / binary / 图片启发式路径派发——
  // 这类附件的 `isOversizedAttach` 在计字符前就 return false（没有可注明正文），
  // 故 `oversized` **恒为 false**，与 `noteText` 永不同时成立。
  // 推论：binary 永不超预算，所以 `noteText` 优先是安全的；若日后给 binary
  // 也计量，`noteText` 提前返回会**静默吃掉降级**，那时必须改成先算再互斥组装。
  if (opts?.noteText != null) {
    return buildFileRefActionXml({
      action,
      path: logicalPath,
      content: opts.noteText,
      display,
    });
  }
  if (opts?.oversized === true) {
    return buildFileRefActionXml({
      action,
      path: logicalPath,
      content: OVERSIZED_ATTACH_NOTE,
      display: "filename",
    });
  }
  const lineBody =
    opts?.bodyIsRendered === true
      ? rawContent
      : renderFileBlockBody({
          logicalPath,
          display,
          content: rawContent,
        });
  return buildFileRefActionXml({
    action,
    path: logicalPath,
    content: lineBody,
    display,
  });
}

/**
 * attach 侧「是否超预算」判据（返回 `true` 即**超限**，走降级出口）。
 *
 * 红线豁免：`attachment.source === "workplace"` 一律不接累加器——workplace 的
 * full 档附件由工作区目录规则支配，若一并计入，用户一条目录规则就能把全部
 * 附件预算吃掉。（这条判据是 workplace 豁免的**真正落点**：预算由
 * `hydrateWorkplaceWithSeen` 照常透传进来，由这里显式拦住。）
 * 二进制 / 图片（`isBinaryOrImageAttach`）没有可注明正文，不计字符。
 */
function isOversizedAttach(
  attachment: MessageAttachment,
  plainLength: number,
  budget: AttachBudget | undefined
): boolean {
  if (budget == null) return false;
  if (attachment.source === "workplace") return false;
  if (isBinaryOrImageAttach(attachment)) return false;
  return !budget.tryConsume(plainLength);
}

/** 首次全文 hydrate（文本 / workplace / filename 档）→ action XML。 */
async function hydrateFileFull(
  attachment: MessageAttachment,
  logicalPath: string,
  runtime: PrepareUserMessagesForPromptRuntime,
  budget: AttachBudget | undefined
): Promise<MessageAttachment> {
  const action =
    attachment.source === "workplace"
      ? ("workplaceChange" as const)
      : ("userAttach" as const);

  if (attachment.content != null) {
    // 已是 action XML → 原样带过（不计量、不降级）
    if (attachment.content.includes("<action ")) {
      return {
        ...attachment,
        path: logicalPath,
        action: attachment.action ?? action,
      };
    }
    // 旧 `<file>` 或裸正文：若含外壳则剥掉再包 action（对齐 hydrateDirAttach）
    const status =
      attachment.source === "workplace"
        ? await resolveWorkplaceStatus(logicalPath, runtime)
        : resolveAttachFileStatus(logicalPath, attachment.type);
    const trimmed = attachment.content.trim();
    const wasLegacyFile =
      trimmed.startsWith("<file ") && trimmed.endsWith("</file>");
    const fileBody = stripLegacyFileWrap(attachment.content, logicalPath);
    // 计量口径与读盘分支对齐：**按原始明文 length**（忽略行号前缀开销）。
    // 旧 `<file>` 外壳内层已是 `renderFileBlockBody` 的行号正文（`1|xxx`），
    // 直接用 `fileBody.length` 会把 `N|` 前缀也计进去，系统性偏高——
    // 同一个文件走存量分支和走读盘分支会得到不同的降级结论。
    const plainLength = wasLegacyFile ? plainLengthOfLineBody(fileBody) : fileBody.length;
    const oversized = isOversizedAttach(attachment, plainLength, budget);
    // 旧块内层已是展示正文（含行号），勿再 contentLines；裸正文走 fileRefAction
    const content = fileRefAction(
      attachment.source === "workplace" ? "workplace" : "attach",
      logicalPath,
      status,
      fileBody,
      wasLegacyFile
        ? {
            bodyIsRendered: true,
            oversized,
            noteText: attachBinaryNote(attachment, status),
          }
        : { oversized, noteText: attachBinaryNote(attachment, status) }
    );
    return {
      ...attachment,
      path: logicalPath,
      action,
      content,
    };
  }

  const status =
    attachment.source === "workplace"
      ? await resolveWorkplaceStatus(logicalPath, runtime)
      : resolveAttachFileStatus(logicalPath, attachment.type);

  const cached = await loadOrFillFileCache({
    sessionId: runtime.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs: runtime.vfs,
    path: logicalPath,
    status,
  });
  return {
    ...attachment,
    path: logicalPath,
    action,
    content: fileRefAction(
      attachment.source === "workplace" ? "workplace" : "attach",
      logicalPath,
      status,
      cached.body,
      {
        oversized: isOversizedAttach(attachment, cached.body.length, budget),
        noteText: attachBinaryNote(attachment, status),
      }
    ),
  };
}

/**
 * attach 源 `filename` 档（`resolveAttachFileStatus` 仅对 image / binary 判 filename）
 * 的正文占位文案；workplace 源返回 undefined（目录规则的 `1|basename` 豁免）。
 */
function attachBinaryNote(
  attachment: MessageAttachment,
  status: WorkplaceDisplayStatus
): string | undefined {
  if (attachment.source === "workplace") return undefined;
  return status === "filename" ? BINARY_ATTACH_NOTE : undefined;
}

async function hydrateDirAttach(
  attachment: MessageAttachment,
  logicalPath: string,
  runtime: PrepareUserMessagesForPromptRuntime
): Promise<MessageAttachment> {
  if (attachment.content != null) {
    if (attachment.content.includes("<action ")) {
      return {
        ...attachment,
        path: logicalPath,
        action: attachment.action ?? "userAttach",
      };
    }
    // 旧 `<dir>` 或已拼好的 ASCII：若含外壳则剥掉再包 action
    const treeBody = stripLegacyDirWrap(attachment.content, logicalPath);
    return {
      ...attachment,
      path: logicalPath,
      action: "userAttach",
      content: buildDirTreeActionXml(logicalPath, treeBody),
    };
  }
  const tree = await renderDirAttachTree(logicalPath, {
    sessionId: runtime.sessionId,
    sessionKkv: runtime.sessionKkv,
    vfs: runtime.vfs,
  });
  return {
    ...attachment,
    path: logicalPath,
    action: "userAttach",
    content: buildDirTreeActionXml(logicalPath, tree),
  };
}

function stripLegacyDirWrap(content: string, logicalPath: string): string {
  const trimmed = content.trim();
  const open = `<dir path="${logicalPath}">`;
  if (trimmed.startsWith("<dir ") && trimmed.endsWith("</dir>")) {
    const firstNl = trimmed.indexOf("\n");
    const lastNl = trimmed.lastIndexOf("\n");
    if (firstNl >= 0 && lastNl > firstNl) {
      return trimmed.slice(firstNl + 1, lastNl);
    }
    // 退化：去掉首尾标签行
    return trimmed
      .replace(/^<dir\b[^>]*>\s*/i, "")
      .replace(/\s*<\/dir>\s*$/i, "");
  }
  void open;
  return trimmed;
}

/**
 * 行号正文（`renderFileBlockBody` 的产物，形如 `1|foo\n2|bar`）的**明文当量长度**。
 *
 * 逐行剥掉 `/^\d+\|` 前缀后求和——降级判据要跟读盘分支（纯明文）同口径，
 * 不能让「存量 `<file>` 外壳」与「读盘全文」对同一份文件给出不同结论。
 */
function plainLengthOfLineBody(lineBody: string): number {
  let total = 0;
  for (const line of lineBody.split("\n")) {
    total += line.replace(/^\d+\|/, "").length;
  }
  return total;
}

/** 剥旧增量外壳 `<file …>…</file>`，取内层正文；非外壳则原样返回。 */
function stripLegacyFileWrap(content: string, logicalPath: string): string {
  const trimmed = content.trim();
  const open = `<file path="${logicalPath}">`;
  if (trimmed.startsWith("<file ") && trimmed.endsWith("</file>")) {
    const firstNl = trimmed.indexOf("\n");
    const lastNl = trimmed.lastIndexOf("\n");
    if (firstNl >= 0 && lastNl > firstNl) {
      return trimmed.slice(firstNl + 1, lastNl);
    }
    return trimmed
      .replace(/^<file\b[^>]*>\s*/i, "")
      .replace(/\s*<\/file>\s*$/i, "");
  }
  void open;
  return trimmed;
}

/** skillAttach 不存在 / 读盘竞态失败时的一行提示（不附全文）。 */
const SKILL_ATTACH_MISSING_NOTE = "技能不存在或已删除";

/** skillAttach 不存在提示行 XML（不写 seen：技能后续创建可自愈重附全文）。 */
function buildSkillAttachMissingXml(name: string): string {
  return buildAttachmentActionXml("skillAttach", {
    name,
    missing: true,
    note: SKILL_ATTACH_MISSING_NOTE,
  });
}

/**
 * skillAttach 附件：skill:{name} 命名空间 seen（与路径 seen 同集合）。
 * 首次读生效副本 SKILL.md 全文；非首次 alreadyReferenced 短标记；
 * 存在性按合并视图（含无效技能，禁用不影响）判定，不存在 → 一行提示且不写 seen。
 * skills 服务未接线时原样带过（不读盘、不写 seen）。
 */
async function hydrateSkillAttachWithSeen(
  attachment: MessageAttachment,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
  resolveSkillNames: () => Promise<Set<string>>,
  budget: AttachBudget | undefined
): Promise<MessageAttachment> {
  const name = attachment.skillName;
  if (typeof name !== "string" || name === "") {
    return attachment;
  }
  const key = skillSeenKey(name);
  if (seen.has(key)) {
    return {
      ...attachment,
      action: "skillAttach",
      content: buildAttachmentActionXml("skillAttach", {
        name,
        alreadyReferenced: true,
      }),
    };
  }
  if (runtime.skills == null || runtime.projectId == null) {
    return attachment;
  }
  // 存在性按合并视图（global ∪ 当前项目，含无效技能；禁用不影响）
  const names = await resolveSkillNames();
  if (!names.has(name)) {
    return {
      ...attachment,
      action: "skillAttach",
      content: buildSkillAttachMissingXml(name),
    };
  }
  try {
    // 跨域读不经 session file_cache：直接读生效副本 SKILL.md 全文（含无效技能原文）
    const file = await runtime.skills.readSkillFile(
      undefined,
      name,
      undefined,
      runtime.projectId
    );
    seen.add(key);
    // 与 userAttach 同一预算累加器：超限则降级为 filename 档引导文案（seen 时序不动）
    const oversized =
      budget != null && !budget.tryConsume(file.content.length);
    return {
      ...attachment,
      action: "skillAttach",
      content: buildAttachmentActionXml("skillAttach", {
        name,
        content: oversized ? OVERSIZED_ATTACH_NOTE : file.content,
        ...(oversized ? { display: "filename" as const } : {}),
      }),
    };
  } catch {
    // 存在性判定与读盘之间被删除等竞态：按不存在处理（不写 seen）
    return {
      ...attachment,
      action: "skillAttach",
      content: buildSkillAttachMissingXml(name),
    };
  }
}

/**
 * attach 源：目录每次树；文本首次全文 / 其后短提示；image/binary 不套短提示仍计 seen；
 * skillAttach 走技能专用 hydrate（skill: 命名空间）。
 */
async function hydrateAttachWithSeen(
  attachment: MessageAttachment,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
  resolveSkillNames: () => Promise<Set<string>>,
  budget: AttachBudget | undefined
): Promise<MessageAttachment> {
  // skillAttach：无 path，不走路径规范化/文件 hydrate
  if (attachment.action === "skillAttach") {
    return hydrateSkillAttachWithSeen(
      attachment,
      runtime,
      seen,
      resolveSkillNames,
      budget
    );
  }
  const rawPath = attachment.path;
  if (rawPath == null || rawPath === "") {
    return attachment;
  }
  const logicalPath = tryNormalizePromptSeenPath(rawPath);
  if (logicalPath == null) {
    return attachment;
  }

  if (attachment.type === "dir") {
    const out = await hydrateDirAttach(attachment, logicalPath, runtime);
    seen.add(logicalPath);
    return out;
  }

  const alreadySeen = seen.has(logicalPath);
  seen.add(logicalPath);

  if (isBinaryOrImageAttach(attachment)) {
    // 非首次仍 filename 档，不套中文短提示
    return hydrateFileFull(
      { ...attachment, path: logicalPath },
      logicalPath,
      runtime,
      budget
    );
  }

  if (alreadySeen) {
    return {
      ...attachment,
      path: logicalPath,
      action: "userAttach",
      content: buildAlreadyReferencedActionXml(logicalPath),
    };
  }

  return hydrateFileFull(
    { ...attachment, path: logicalPath },
    logicalPath,
    runtime,
    budget
  );
}

/**
 * workplace 源：首次全文；非首次 content 空（wrap 省略）。
 *
 * 省略判定读**两个**集合（spec G6 双读）：共享 `seen`（attach 抢先 / 跨消息抑制
 * 的运行期语义不动，判据后仍照旧 `seen.add`）+ `workplaceSeen`（工作区已展示集，
 * 初值 = assemble 的 `visiblePaths`，缺省回落 `seenPaths`；**不写回 seen**）。
 */
async function hydrateWorkplaceWithSeen(
  attachment: MessageAttachment,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
  workplaceSeen: Set<string>,
  budget: AttachBudget | undefined
): Promise<MessageAttachment> {
  const rawPath = attachment.path;
  if (rawPath == null || rawPath === "") {
    return attachment;
  }
  const logicalPath = tryNormalizePromptSeenPath(rawPath);
  if (logicalPath == null) {
    return attachment;
  }

  if (seen.has(logicalPath) || workplaceSeen.has(logicalPath)) {
    return {
      ...attachment,
      path: logicalPath,
      action: "workplaceChange",
      content: "",
    };
  }
  seen.add(logicalPath);
  // 预算照常透传给 hydrateFileFull：workplace 豁免 = 其内部 {@link isOversizedAttach}
  // 里那条显式 source 判据（透传后生效）。豁免因此落在「判据」而非「不传参」——
  // 传参缺失会让该判据退化成死代码，日后有人删掉它也毫无症状。
  return hydrateFileFull(
    { ...attachment, path: logicalPath },
    logicalPath,
    runtime,
    budget
  );
}

async function prepareOneUserMessage(
  message: ChatMessage,
  runtime: PrepareUserMessagesForPromptRuntime,
  seen: Set<string>,
  workplaceSeen: Set<string>,
  isLatestUser: boolean,
  resolveSkillNames: () => Promise<Set<string>>,
  budget: AttachBudget | undefined
): Promise<ChatMessage> {
  if (message.hidden) {
    // hidden：不 hydrate/wrap；库内 attachments 保留在原消息上
    return message;
  }

  // extra info（customAttach）只对最新一条 user 消息拼接：历史消息不注入。
  // 与 dynamic 区 once 语义不同——这里是注入位收窄，不是块级去重。
  const effectiveExtraInfo = isLatestUser ? runtime.extraInfo : undefined;
  const attachments = message.attachments ?? [];
  const hasExtraInfo =
    typeof effectiveExtraInfo === "string" &&
    effectiveExtraInfo.trim().length > 0;
  // 无附件且无 extraInfo：恒等原文，不走 wrap。
  if (attachments.length === 0 && !hasExtraInfo) {
    return message;
  }

  // 单条内固定 attach → workplace → user_ops，不依赖落库数组序
  const attachList = attachments.filter((a) => a.source === "attach");
  const workplaceList = attachments.filter((a) => a.source === "workplace");
  const userOpsList = attachments.filter((a) => a.source === "user_ops");

  const hydratedBySource = new Map<MessageAttachment, MessageAttachment>();

  for (const att of attachList) {
    hydratedBySource.set(
      att,
      await hydrateAttachWithSeen(att, runtime, seen, resolveSkillNames, budget)
    );
  }
  for (const att of workplaceList) {
    hydratedBySource.set(
      att,
      await hydrateWorkplaceWithSeen(att, runtime, seen, workplaceSeen, budget)
    );
  }
  for (const att of userOpsList) {
    // user_ops 原样带过，不参与 path 首次判定
    hydratedBySource.set(att, att);
  }

  // 保持原 attachments 数组序（仅内容已按 source 优先级处理）
  const hydrated: MessageAttachment[] = attachments.map(
    (a) => hydratedBySource.get(a) ?? a
  );

  const plainText = messageBodyTextFromContent(message.content);
  const wrapped = wrapUserMessageForLlm(
    plainText,
    hydrated,
    effectiveExtraInfo
  );

  return {
    ...message,
    content: textBlocks(wrapped),
    // wrap 后仍保留 attachments，供 normalizeForLlmExport 禁 merge
    attachments: hydrated,
  };
}

/**
 * 遍历 messages：跳过 hidden 的 hydrate/wrap；对非 hidden user 做附件 hydrate + wrap。
 *
 * **不写回** `content_json`；仅返回内存侧 messages。
 * 非 user / 无附件消息原样通过。
 *
 * @param runtime.seenPaths 常驻前缀 S0；应在 assemble 之后传入。
 */
export async function prepareUserMessagesForPrompt(
  messages: readonly ChatMessage[],
  runtime: PrepareUserMessagesForPromptRuntime
): Promise<ChatMessage[]> {
  const seen = createPromptPathSeenSet(runtime.seenPaths);
  // 附件明文体积预算（与 seen 同级作用域）：**整个拼装共享一份** 500k 上限
  // （ATTACH_PROMPT_CHAR_BUDGET，50 万明文字符），逐条累加、恰好等于预算不降级，
  // 超出项降级为 filename 档引导文案。
  // workplace 源豁免（见 hydrateFileFull 的红线注释）。
  const attachBudget = createAttachBudget();
  // workplace 省略判定的第二读集合（spec G6 双读）：初值取 assemble 的
  // `visiblePaths`（full + header + filename 全量可见集），**未注入时回落
  // `seenPaths`**——旧调用方与既有语义（T-PD3 / T-PD4 / T-PD8 / T-SR6）零变化。
  //
  // 注意它只在 `hydrateWorkplaceWithSeen` 里被**读**，从不写入共享 `seen`：
  // attach 抢先 seen、跨消息抑制这些运行期语义完全不动。
  const workplaceSeen = createPromptPathSeenSet(
    runtime.workplaceSeenPaths ?? runtime.seenPaths
  );
  // seen 共享（方向 B）：可见历史里 assistant 已通过 skill 工具 load 过的
  // 技能预填进 seen——load 的全文以 tool_result 形式留在可见历史，后续
  // `$` 引用走 alreadyReferenced 短提示，防止同一正文注入两遍。压缩隐藏
  // 后不在窗口内，自然重置（与附件 seen 同口径自愈）。
  for (const message of messages) {
    if (message.role !== "assistant" || message.hidden) continue;
    for (const block of message.content.blocks) {
      if (block.type !== "tool_use" || block.name !== SKILL_TOOL_NAME) continue;
      const action = block.input?.action;
      const name = block.input?.name;
      if (action === "load" && typeof name === "string" && name !== "") {
        seen.add(skillSeenKey(name));
      }
    }
  }
  // 每轮 prepare 展开一次 customAttach 宏（与 dynamic 区每步展开对齐），同一轮内所有 user 消息复用同一份文本。
  const extraInfoResolved =
    typeof runtime.extraInfo === "string" && runtime.extraInfo.trim().length > 0
      ? await expandDynamicMacros(runtime.extraInfo, {
          now: runtime.now,
          workplace: runtime.workplace,
          filetree: runtime.filetree,
        })
      : undefined;
  const resolvedRuntime: PrepareUserMessagesForPromptRuntime =
    extraInfoResolved === undefined
      ? runtime
      : { ...runtime, extraInfo: extraInfoResolved };
  // extra info 只对最新一条 user 输入消息生效：反向扫一遍找最后一条
  // role==='user' && isUserInputMessage(message) && !message.hidden 的 index。
  // hidden 不计入（不进输出）；非用户输入的 user 消息（tool_result）也不计入。
  let latestUserInputIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user" && !m.hidden && isUserInputMessage(m)) {
      latestUserInputIndex = i;
      break;
    }
  }
  const out: ChatMessage[] = [];
  // 每轮 prepare 预算一次合并视图技能名集合（skillAttach 存在性判定用）；
  // 惰性求值——本轮没有命中存在性判定的 skillAttach 时不产生 IO
  let skillNames: Promise<Set<string>> | null = null;
  const resolveSkillNames = (): Promise<Set<string>> => {
    skillNames ??= (async () => {
      if (runtime.skills == null || runtime.projectId == null) {
        return new Set<string>();
      }
      try {
        const list = await runtime.skills.effectiveSkills(runtime.projectId);
        return new Set(list.map((s) => s.name));
      } catch {
        return new Set<string>();
      }
    })();
    return skillNames;
  };
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role !== "user") {
      out.push(message);
      continue;
    }
    // 非用户输入的 user 消息（含 tool_result 的工具结果）直接透传，不走 wrap——
    // wrap 会把 block 类型拍平成 text，导致 LLM API 报 tool 配对错误。
    if (!isUserInputMessage(message)) {
      out.push(message);
      continue;
    }
    out.push(
      await prepareOneUserMessage(
        message,
        resolvedRuntime,
        seen,
        workplaceSeen,
        i === latestUserInputIndex,
        resolveSkillNames,
        attachBudget
      )
    );
  }
  // v1.5.30 unref 回迁：存量 contentRef 块的极简兜底 hydrate 在此统一发生
  // ——按 (entryId, version) 查 revision 明文，回填 `{path, content}` 的
  // JSON 字符串（内存态，不写回 content_json）。
  //
  // **顺序红线**：必须发生在 normalizeOrphanToolResultsForLlm 之前：孤儿拍平
  // 吃 messageBodyText，未 hydrate 的空 content 会被拍成 `[tool_result id=…]`
  // 占位文本、正文再也补不回来；主链（LLM 装配）与 parity 链（token/压缩口径）
  // 共用本函数，同受益。
  return hydrateToolResultsForPrompt(out, runtime.revisionRepo);
}
