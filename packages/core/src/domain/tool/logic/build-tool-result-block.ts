/**
 * Assembles persisted {@link ToolResultBlock} from runner outcomes.
 *
 * @remarks
 * - `content` is LLM-facing text only (adapters ignore `ok` / `summary`).
 * - UI should use {@link resolveToolResultOk} instead of scanning `content`.
 *
 * @module domain/tool/logic/build-tool-result-block
 */

import type {
  ReadResultRef,
  SkillResultRef,
  SkillToolRef,
  ToolResultBlock,
} from "@/domain/chat/model/content-block.js";
import { resolveSkillToolRefFromOutput } from "@/domain/chat/logic/skill-tool-ref.js";
import {
  formatToolErrorForLlm,
  formatToolOutputForLlm,
} from "./format-tool-output.js";
import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";
import type { ParallelToolOutcome } from "./tool-runner.js";
import { TOOL_OUTPUT_MAX_BYTES } from "../logic/tool-output-limits.js";

export interface BuildToolResultBlockMeta {
  readonly toolName?: string;
  readonly vfsScope?: VfsScope;
  /**
   * `task` 工具输出中的 `subagentSessionId`，透传到 `ToolResultBlock.meta.subagentSessionId`。
   *
   * 调用方可从 `outcome.output.subagentSessionId` 或独立源头传入；任一来源均为 string 时生效。
   */
  readonly subagentSessionId?: string;
  /**
   * `skill` project 域解析上下文（当前会话 projectId）。read 缺省域命中
   * 生效副本时输出只携带命中 domain/name，projectId 由这里补进 `meta.skillRef`。
   */
  readonly skillProjectId?: string;
}

/** UI / legacy: explicit `ok` wins; otherwise infer from `Error:` prefix only. */
export function resolveToolResultOk(block: ToolResultBlock): boolean {
  if (block.ok === false) {
    return false;
  }
  if (block.ok === true) {
    return true;
  }
  return !block.content.trimStart().startsWith("Error:");
}

/**
 * 从 read 成功输出解析 `contentRef`（read-tool-result-ref）。
 *
 * 仅 `toolName === "read"` 且输出携带 head 定位三件套
 * （entryId/version/contentHash + totalBytes）时生效——vfs-tools 只在
 * ctx 注入 adjustRevisionRefCount 并同步 +1 之后才把这些字段放进输出，
 * 「有 entryId ⟺ revision 已保活」，这里产的引用块不会悬空。其余工具 /
 * 旧形态输出（含 mock ctx 的测试）返回 undefined，走 legacy 全文 content。
 *
 * 派生参数（offset/limit/returnedLines/totalLines/truncated/
 * lastLineTruncated/nextOffset）全部取自 read 截断管线的结果输出——
 * `formatReadOutput` 重放要用的输入必须自包含在 ref 里。
 */
function resolveReadResultRefFromOutcome(
  toolName: string | undefined,
  output: unknown
): ReadResultRef | undefined {
  if (toolName !== "read" || !isRecord(output)) {
    return undefined;
  }
  const { entryId, version, contentHash, totalBytes } = output;
  if (
    typeof entryId !== "number" ||
    typeof version !== "number" ||
    typeof contentHash !== "string" ||
    contentHash === "" ||
    typeof totalBytes !== "number"
  ) {
    return undefined;
  }
  const { path, offset, returnedLines, totalLines, truncated } = output;
  if (
    typeof path !== "string" ||
    typeof offset !== "number" ||
    typeof returnedLines !== "number" ||
    typeof totalLines !== "number" ||
    typeof truncated !== "boolean"
  ) {
    return undefined;
  }
  const limit = output.limit;
  const lastLineTruncated = output.lastLineTruncated;
  const nextOffset = output.nextOffset;
  return {
    path,
    entryId,
    version,
    contentHash,
    totalBytes,
    offset,
    ...(typeof limit === "number" ? { limit } : {}),
    returnedLines,
    totalLines,
    truncated,
    ...(lastLineTruncated === true ? { lastLineTruncated: true } : {}),
    ...(typeof nextOffset === "number" ? { nextOffset } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从 skill 成功输出解析 `contentRef`（skill-result-ref）。
 *
 * 仅 `toolName === "skill"` 且 `action ∈ {load, read}`、输出携带 head 定位
 * 三件套时生效——skill-tool 只在 ctx 注入 adjustRevisionRefCount 并同步 +1
 * 之后才把这些字段放进输出，「有 entryId ⟺ revision 已保活」，这里产的
 * 引用块不会悬空。其余 action（write/edit/list）与旧形态输出（含 mock ctx
 * 的测试）返回 undefined，走 legacy 全文 content。
 *
 * **字段校验按 action 拆两套**（wire 冻结函数的入参面不同）：
 * - read：wire 走 `formatReadOutput`，全量校验分页派生参数（offset /
 *   limit / returnedLines / totalLines / truncated / nextOffset）；
 * - load：wire 走 `formatSkillLoadOutput`，只吃 path/content/truncated/
 *   files，load 输出本无分页字段（恒记 offset=1 / returnedLines=0 /
 *   totalLines=0 作占位）——故只校验 version/truncated/files/三件套。
 *
 * alreadyReferenced 形态不带三件套（工具不 +1、不产 ref），自然落回
 * legacy 全文。
 */
function resolveSkillResultRefFromOutcome(
  toolName: string | undefined,
  output: unknown
): SkillResultRef | undefined {
  if (toolName !== "skill" || !isRecord(output)) {
    return undefined;
  }
  const { action, domain, name, path, entryId, version, contentHash, totalBytes } =
    output;
  if (action !== "load" && action !== "read") {
    return undefined;
  }
  // alreadyReferenced 形态**永不产 ref**：load 时若技能全文已在本请求提示词
  // 中，工具侧已提前 return 出常量 tip——既不 +1 也没有正文可引（下面三件套
  // 校验本就必然把它挡下，这里显式短路只为把这条隐式耦合写明）。
  // hydrate 侧无法重放 tip 语义：`formatSkillLoadOutput` 对
  // alreadyReferenced 直返 content 常量，ref 里既没有「本请求已注入」的
  // 状态位也没有 files/正文，产了就等于给 LLM 发一段查无出处的提示，破 wire。
  if (action === "load" && output.alreadyReferenced === true) {
    return undefined;
  }
  if (
    (domain !== "global" && domain !== "project") ||
    typeof name !== "string" ||
    typeof path !== "string" ||
    typeof entryId !== "number" ||
    typeof version !== "number" ||
    typeof contentHash !== "string" ||
    contentHash === "" ||
    typeof totalBytes !== "number"
  ) {
    return undefined;
  }
  const truncated = output.truncated;
  if (typeof truncated !== "boolean") {
    return undefined;
  }
  if (action === "load") {
    const files = output.files;
    if (!Array.isArray(files) || files.some((f) => typeof f !== "string")) {
      return undefined;
    }
    return {
      kind: "skill",
      action: "load",
      domain,
      name,
      path,
      entryId,
      version,
      contentHash,
      totalBytes,
      // load 无分页参数：offset/returnedLines/totalLines 恒为 `1/0/0` 占位
      // **假值**（load 输出本就不带这三个数，真实值只在执行时被截断推导算出、
      // 从不落 ref），只为让 hydrate 侧两条 action 共用一套字段校验与 parse
      // 白名单——wire 重放不读这三个数（`formatSkillLoadOutput` 只吃
      // path/content/truncated/files）。
      // 「让 deriveSkillLoadTruncation 回真值」这条路被有意否掉：load 输出会
      // 多带 totalLines，而 `formatSkillLoadOutput` 内部委托 `formatReadOutput`
      // ——truncated 时它会把 `Total lines: N.` 拼进 wire，hydrate 侧重放记录
      // 不带该字段就会与之失配；改 wire 就得给冻结 formatter 版本化。
      // 契约钉在 {@link SkillResultRef} 的字段注释上：消费方按 action 分派，
      // 禁止读 load 侧这三个假值。
      offset: 1,
      returnedLines: 0,
      totalLines: 0,
      truncated,
      files: files as string[],
    };
  }
  const { offset, returnedLines, totalLines } = output;
  const limit = output.limit;
  const nextOffset = output.nextOffset;
  if (
    typeof offset !== "number" ||
    typeof returnedLines !== "number" ||
    typeof totalLines !== "number"
  ) {
    return undefined;
  }
  return {
    kind: "skill",
    action: "read",
    domain,
    name,
    path,
    entryId,
    version,
    contentHash,
    totalBytes,
    offset,
    ...(typeof limit === "number" ? { limit } : {}),
    returnedLines,
    totalLines,
    truncated,
    ...(typeof nextOffset === "number" ? { nextOffset } : {}),
    // load 专属字段（read 不产出）：空清单占位，使 parse 白名单与 hydrate
    // 侧无需按 action 二次分派。
    files: [],
  };
}

/** 字节数格式化：1024 进位（B/KB/MB）、保留 1 位小数（整数位不带 .0）。 */
function formatByteSize(bytes: number): string {
  const trimFraction = (n: number): string => {
    const s = n.toFixed(1);
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  };
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trimFraction(kb)}KB`;
  return `${trimFraction(kb / 1024)}MB`;
}

function summarizeToolSuccess(
  toolName: string | undefined,
  output: unknown
): string | undefined {
  if (!isRecord(output)) {
    return undefined;
  }
  const name = toolName ?? "";

  if (name === "read") {
    const returned = output.returnedLines;
    const total = output.totalLines;
    if (typeof returned === "number" && typeof total === "number") {
      if (output.truncated === true) {
        return `truncated · ${returned}/${total} lines`;
      }
      return `${returned} lines`;
    }
  }

  if (name === "edit") {
    const replacements = output.replacements;
    if (typeof replacements === "number") {
      return replacements === 1 ? "ok" : `${replacements} replacements`;
    }
  }

  if (name === "write" || output.ok === true) {
    if (typeof output.version === "number" || output.ok === true) {
      return "ok";
    }
  }

  if (name === "fs" && Array.isArray(output.entries)) {
    const count = output.entries.length;
    const total = typeof output.total === "number" ? output.total : count;
    if (output.truncated === true) {
      return `${count}/${total} entries`;
    }
    return `${count} entries`;
  }

  // skill：按输出携带的 action 分发（load 域+文件数 / read 行数 / write 域+路径 /
  // edit 替换数 / list 条数）。必须在下方 generic matches/paths 分支之前——
  // list 输出的 entries+total 会撞上。
  if (name === "skill" && typeof output.action === "string") {
    if (output.action === "load") {
      const parts: string[] = [];
      if (
        typeof output.domain === "string" &&
        typeof output.name === "string"
      ) {
        parts.push(`${output.domain}:${output.name}`);
      }
      if (output.alreadyReferenced === true) {
        parts.push("已在提示词中");
      } else if (Array.isArray(output.files)) {
        parts.push(`${output.files.length} files`);
      }
      if (parts.length > 0) return parts.join(" · ");
    }
    if (output.action === "read") {
      const returned = output.returnedLines;
      const total = output.totalLines;
      if (typeof returned === "number" && typeof total === "number") {
        if (output.truncated === true) {
          return `truncated · ${returned}/${total} lines`;
        }
        return `${returned} lines`;
      }
    }
    if (
      (output.action === "write" || output.action === "edit") &&
      typeof output.domain === "string" &&
      typeof output.name === "string" &&
      typeof output.path === "string"
    ) {
      if (output.action === "edit" && typeof output.replacements === "number") {
        return output.replacements === 1
          ? `${output.domain}:${output.name}/${output.path}`
          : `${output.replacements} replacements · ${output.domain}:${output.name}/${output.path}`;
      }
      return `${output.domain}:${output.name}/${output.path}`;
    }
    if (output.action === "list" && Array.isArray(output.entries)) {
      return `${output.entries.length} skills`;
    }
  }

  // agent：按输出 action 分发（list 条数 / get 定义名 / create+update 保存名）。
  // 与 skill 同理必须在下方 generic matches/paths 分支之前——list 输出的
  // entries+total 会撞上。
  if (name === "agent" && typeof output.action === "string") {
    if (output.action === "list" && Array.isArray(output.entries)) {
      const count = output.entries.length;
      const total = typeof output.total === "number" ? output.total : count;
      if (output.truncated === true) {
        return `${count}/${total} agents`;
      }
      return `${count} agents`;
    }
    if (output.action === "get") {
      const def = output.definition;
      if (isRecord(def) && typeof def.name === "string") {
        return def.name;
      }
    }
    if (
      (output.action === "create" || output.action === "update") &&
      typeof output.name === "string"
    ) {
      return `已保存 ${output.name}`;
    }
  }

  // search：引擎 · N 条结果；超预算落盘形态（Step 6 后出现）显示已落盘路径。
  // 未配置提示是纯字符串输出（非 record），在上方 isRecord 门处已返回 undefined。
  if (name === "search") {
    if (typeof output.engine === "string" && Array.isArray(output.results)) {
      return `${output.engine} · ${output.results.length} 条结果`;
    }
    if (typeof output.savedPath === "string") {
      return `已落盘 ${output.savedPath}`;
    }
  }

  // curl：状态 · 原始体积（如 `200 · 12.3KB`）；截断时保留量/原始量
  // （如 `truncated · 50KB/1.2MB`）。超预算落盘形态优先：显示已落盘路径
  // （正文已存 /tmp/，体积档位无意义）；降级截断路径 body 含标注行会
  // 略超预算，展示上按预算值口径（TOOL_OUTPUT_MAX_BYTES）。非文本占位
  // 与预检占位很小，照 body 现算。
  if (name === "curl") {
    if (typeof output.savedPath === "string") {
      return `已落盘 ${output.savedPath}`;
    }
    const status = output.status;
    const originalBytes = output.originalBytes;
    if (typeof status === "number" && typeof originalBytes === "number") {
      if (output.truncated === true) {
        const bodyBytes =
          typeof output.body === "string"
            ? new TextEncoder().encode(output.body as string).byteLength
            : undefined;
        // 正常截断路径 body 含标注行会略超预算，展示上按预算值口径。
        const kept =
          bodyBytes != null && bodyBytes < TOOL_OUTPUT_MAX_BYTES
            ? bodyBytes
            : TOOL_OUTPUT_MAX_BYTES;
        return `truncated · ${formatByteSize(kept)}/${formatByteSize(
          originalBytes
        )}`;
      }
      return `${status} · ${formatByteSize(originalBytes)}`;
    }
  }

  const matchItems = output.matches ?? output.paths;
  if (Array.isArray(matchItems) && typeof output.total === "number") {
    const n = matchItems.length;
    const label = name === "glob" ? "paths" : "matches";
    if (output.truncated === true) {
      return `${n}/${output.total} ${label}`;
    }
    return `${n} ${label}`;
  }

  return undefined;
}

function summarizeToolError(content: string): string | undefined {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("Error:")) {
    return undefined;
  }
  const msg = trimmed.slice("Error:".length).trimStart();
  return msg.length > 120 ? `${msg.slice(0, 117)}…` : msg;
}

/**
 * Maps one parallel tool outcome to a block ready for session persistence.
 */
export function buildToolResultBlock(
  toolUseId: string,
  outcome: ParallelToolOutcome,
  meta?: BuildToolResultBlockMeta
): ToolResultBlock {
  if (outcome.ok) {
    const content = formatToolOutputForLlm(outcome.output);
    const summary = summarizeToolSuccess(meta?.toolName, outcome.output);
    // task 工具输出对象形如 { text, subagentSessionId }：透传 subagentSessionId 到 meta。
    const subagentSessionId = resolveSubagentSessionIdFromOutcome(
      outcome.output,
      meta?.subagentSessionId
    );
    // skill 成功输出携带实际 domain/name（read 缺省域命中生效副本的解析结果
    // 也在这里）：照 subagentSessionId 自动检测透传到 meta.skillRef。
    const skillRef = resolveSkillToolRefFromOutcome(
      meta?.toolName,
      outcome.output,
      meta?.skillProjectId
    );

    // 引用块（read-tool-result-ref / skill-result-ref）：read / skill read /
    // skill load 成功输出携带 head 定位三件套（工具已同步 +1 保活）时产
    // contentRef——content 置占位空串，wire 侧 hydrate 按 (entryId, version)
    // 重放对应冻结 formatter 还原全文；summary 照旧生成（UI 卡片零改动）。
    // 二者互斥（工具名不同），先 read 后 skill。
    const contentRef =
      resolveReadResultRefFromOutcome(meta?.toolName, outcome.output) ??
      resolveSkillResultRefFromOutcome(meta?.toolName, outcome.output);

    // 中断回流（phase-1-abort-reflow）：outcome.ok=true 但 output.stopped=true 表示
    // 子 agent 被用户中断。tool-result 要标 ok=false（主 agent 区分「用户停止」与「崩溃」），
    // content 是 task 输出的 JSON 壳（含 text + stopped + failureReason + subagentSessionId），
    // meta 额外带 failureReason（UI 卡片用）。
    if (isStoppedTaskOutput(outcome.output)) {
      const failureReason = readFailureReason(outcome.output);
      return {
        type: "tool_result",
        toolUseId,
        ok: false,
        content,
        ...(subagentSessionId != null
          ? {
              meta: {
                ...(failureReason != null ? { failureReason } : {}),
                subagentSessionId,
              },
            }
          : failureReason != null
          ? { meta: { failureReason } }
          : {}),
      };
    }

    return {
      type: "tool_result",
      toolUseId,
      ok: true,
      // 引用态 content 置空串（hydrate 重放还原 wire 字节）；legacy 态照旧全文。
      ...(contentRef != null
        ? { content: "", contentRef }
        : { content }),
      ...(summary != null ? { summary } : {}),
      ...(subagentSessionId != null || skillRef != null
        ? {
            meta: {
              ...(subagentSessionId != null ? { subagentSessionId } : {}),
              ...(skillRef != null ? { skillRef } : {}),
            },
          }
        : {}),
    };
  }

  const content = formatToolErrorForLlm(outcome.error, {
    vfsScope: meta?.vfsScope,
  });
  const summary = summarizeToolError(content);
  return {
    type: "tool_result",
    toolUseId,
    ok: false,
    content,
    ...(summary != null ? { summary } : {}),
  };
}

/**
 * 检测 task 工具输出是否携带有「用户停止」标记（phase-1-abort-reflow）。
 *
 * outcome.ok=true 但 output.stopped=true 时，buildToolResultBlock 要把这条
 * tool_result 标成 ok=false。本函数只做窄义类型守卫，不复用 resolveSubagentSessionIdFromOutcome
 * 的 object 判定，语义上更直结。
 */
function isStoppedTaskOutput(output: unknown): boolean {
  return (
    output != null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    (output as { stopped?: unknown }).stopped === true
  );
}

/** 从 task 工具输出读取 failureReason（仅 string 时生效，否则返回 undefined）。 */
function readFailureReason(output: unknown): string | undefined {
  if (output == null || typeof output !== "object" || Array.isArray(output)) {
    return undefined;
  }
  const reason = (output as { failureReason?: unknown }).failureReason;
  return typeof reason === "string" ? reason : undefined;
}

/**
 * 从工具输出对象或显式 meta 提取 `subagentSessionId`。
 *
 * 优先 `outcome.output.subagentSessionId`（string 时生效）；否则回落到调用方显式传入的 meta。
 * 仅 task 工具有该字段，其他工具输出不含 subagentSessionId，返回 undefined。
 */
function resolveSubagentSessionIdFromOutcome(
  output: unknown,
  fallback?: string
): string | undefined {
  if (
    output != null &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    typeof (output as { subagentSessionId?: unknown }).subagentSessionId ===
      "string"
  ) {
    return (output as { subagentSessionId: string }).subagentSessionId;
  }
  return typeof fallback === "string" && fallback.length > 0
    ? fallback
    : undefined;
}

/**
 * 从 skill 成功输出提取跳转三元组（失败 outcome 一律 undefined）。
 *
 * 仅 `meta.toolName === "skill"` 时有意义；实际判定在
 * `resolveSkillToolRefFromOutput` 内（工具名 + 输出形态双门控）。
 */
function resolveSkillToolRefFromOutcome(
  toolName: string | undefined,
  output: unknown,
  skillProjectId?: string
): SkillToolRef | undefined {
  if (toolName == null) return undefined;
  return resolveSkillToolRefFromOutput(toolName, output, skillProjectId);
}
