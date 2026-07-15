/**
 * `@` 目录附件：仅列出根下直子名字（文件 / 文件夹），不读正文、不写 file_cache。
 *
 * @module domain/chat/logic/render-dir-attach-tree
 */

import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";

/** 单次目录树拼装 UTF-8 上限（SPEC：512KiB）。 */
export const ATTACH_DIR_TREE_MAX_UTF8_BYTES = 512 * 1024;

/** {@link renderDirAttachTree} 依赖。 */
export interface RenderDirAttachTreeDeps {
  readonly sessionId: string;
  /** 保留透传兼容；本函数不再读写 file_cache。 */
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
  /** 覆盖截断阈值（单测用）；默认 {@link ATTACH_DIR_TREE_MAX_UTF8_BYTES}。 */
  readonly maxUtf8Bytes?: number;
}

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function withTrailingSlash(dirPath: string): string {
  if (dirPath === "" || dirPath === "/") {
    return dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
  }
  return dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
}

/** 取 path 末段名；目录带尾 `/`。 */
function entryDisplayName(
  entryPath: string,
  kind: "file" | "directory",
): string {
  const parts = entryPath.replace(/\/+$/, "").split("/").filter(Boolean);
  const base = parts[parts.length - 1] ?? entryPath;
  return kind === "directory" ? `${base}/` : base;
}

/**
 * 渲染以 `rootDir` 为根的 depth=1 名字树；超长截断并在末尾追加 `[truncated]` 注释行。
 *
 * 例：
 * ```
 * /notes/
 *   a.md
 *   sub/
 * ```
 */
export async function renderDirAttachTree(
  rootDir: string,
  deps: RenderDirAttachTreeDeps,
): Promise<string> {
  const maxBytes = deps.maxUtf8Bytes ?? ATTACH_DIR_TREE_MAX_UTF8_BYTES;
  const normalizedRoot = rootDir.replace(/\/+$/, "") || "/";
  const rootLine = withTrailingSlash(normalizedRoot);

  let entries: Awaited<ReturnType<VfsService["list"]>>;
  try {
    entries = await deps.vfs.list(normalizedRoot, { recursive: false });
  } catch {
    // 目录不存在时仍输出根行，便于 prompt 侧感知路径
    return rootLine;
  }

  const childLines = entries
    .map((e) => entryDisplayName(e.path, e.kind))
    .sort((a, b) => a.localeCompare(b));

  // 根行 + 直子名字（两空格缩进）；目录名带尾 /
  const parts: string[] = [`${rootLine}\n`];
  let truncated = false;

  for (const name of childLines) {
    const chunk = `  ${name}\n`;
    const next = parts.join("") + chunk;
    if (utf8ByteLength(next) > maxBytes) {
      truncated = true;
      break;
    }
    parts.push(chunk);
  }

  let out = parts.join("").replace(/\n$/, "");
  if (truncated) {
    out = `${out}\n<!-- [truncated] -->`;
  }
  return out;
}
