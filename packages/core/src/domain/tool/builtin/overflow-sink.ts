/**
 * 超预算工具输出落盘公共机制（overflow-sink）：curl / search 共用。
 *
 * 工具输出序列化超过 `TOOL_OUTPUT_MAX_BYTES`（50KB）时，把**截断前的
 * 全文**写入会话工作区 VFS `/tmp/`，工具结果只回 `{savedPath, message}`
 * ——模型可经 read 分页读取完整内容。子代理经装配链的 `toolCtx.vfs`
 * 天然指向父会话 VFS（T-SS-3 锁定），落盘即落父会话工作区。
 *
 * 设计口径（SPEC web-search-tool Step 5）：
 * - 文件名 `/tmp/{tool}-{yyyyMMdd}-{rand4}.{ext}`：`tool` 是调用方工具
 *   名，`yyyyMMdd` 取本地日期，`rand4` 是 4 位十六进制随机后缀；`ext`
 *   按调用方传入的 content-type 映射 html / json / txt（缺省 txt）。
 * - 落盘成功后照 write 工具口径执行配套动作：upsert `file_cache`
 *   `full:{path}`（同会话内后续 read 命中免重读盘）+ 为 `/tmp` 补默认
 *   目录规则。两者是辅助步骤：文件已落盘，失败不阻断（吞错留 debug
 *   trace，返回路径仍有意义）。
 * - `vfs.write` 失败会让本函数抛错，由调用方决定降级（curl 回落字节
 *   截断、search 回落完整输出）——不在这里吞，吞了调用方无从感知。
 *
 * @module domain/tool/builtin/overflow-sink
 */

import type { BuiltinToolContext } from "./builtin-tool-context.js";
import { TOOL_OUTPUT_MAX_BYTES } from "../logic/tool-output-limits.js";
import {
  ensureDirRulesForNewPath,
  upsertFileCacheAfterWrite,
} from "./vfs-tools.js";

/** 落盘子目录（会话工作区 VFS 内，子代理时为父会话工作区）。 */
export const OVERFLOW_SINK_DIR = "/tmp";

/** `sinkOversizedOutput` 入参。 */
export interface SinkOversizedInput {
  /** 调用方工具名（文件名前缀，如 "curl" / "search"）。 */
  readonly tool: string;
  /** 截断前的完整输出正文（原文落盘，不做任何截断）。 */
  readonly content: string;
  /** 输出内容的 content-type（用于扩展名映射；缺省按 txt）。 */
  readonly contentType: string;
}

/** `sinkOversizedOutput` 返回值。 */
export interface OversizedSinkResult {
  /** 落盘路径（会话工作区 VFS 内，如 `/tmp/curl-20260906-1f2e.html`）。 */
  readonly savedPath: string;
  /** 给模型看的落盘说明（含 read 读取指引）。 */
  readonly message: string;
}

/**
 * content-type → 扩展名映射：含 json → `json`，含 html → `html`，
 * 其余（text/plain、xml、缺省等）→ `txt`。
 */
export function extensionForContentType(
  contentType: string
): "html" | "json" | "txt" {
  const lower = contentType.toLowerCase();
  if (lower.includes("json")) return "json";
  if (lower.includes("html")) return "html";
  return "txt";
}

/** 生成本地日期戳 `yyyyMMdd`。 */
function localDateStamp(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}${month}${day}`;
}

/** 生成落盘文件路径 `/tmp/{tool}-{yyyyMMdd}-{rand4}.{ext}`。 */
function buildSinkPath(tool: string, contentType: string): string {
  const rand4 = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `${OVERFLOW_SINK_DIR}/${tool}-${localDateStamp(new Date())}-${rand4}.${extensionForContentType(contentType)}`;
}

/**
 * 把超预算输出全文落盘到会话工作区 `/tmp/`，返回 `{savedPath, message}`。
 *
 * @throws `vfs.write` 失败时原样抛出（调用方降级）；落盘成功后的
 * `file_cache` upsert 与目录规则补齐失败只吞错不阻断。
 */
export async function sinkOversizedOutput(
  ctx: BuiltinToolContext,
  input: SinkOversizedInput
): Promise<OversizedSinkResult> {
  const savedPath = buildSinkPath(input.tool, input.contentType);
  await ctx.vfs.write(savedPath, input.content);
  // 配套动作失败不阻断（照 write 工具口径）：file_cache 是加速缓存，
  // 目录规则是辅助展示配置——文件已落盘，返回路径仍有效。
  try {
    await upsertFileCacheAfterWrite(ctx, savedPath, input.content);
  } catch (error) {
    console.debug(
      `[overflow-sink] file_cache upsert 失败（${savedPath}）:`,
      error
    );
  }
  await ensureDirRulesForNewPath(ctx, OVERFLOW_SINK_DIR);
  const contentBytes = new TextEncoder().encode(input.content).byteLength;
  return {
    savedPath,
    message: `输出超过 ${
      TOOL_OUTPUT_MAX_BYTES / 1024
    }KB 预算（original ${contentBytes} bytes），全文已自动保存到会话工作区，可用 read 分页读取。`,
  };
}
