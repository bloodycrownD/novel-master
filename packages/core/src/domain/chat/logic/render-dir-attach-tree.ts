/**
 * `@` 目录附件：仅列出根下直子名字（文件 / 文件夹），`$filetree` 风格 ASCII，
 * 不读正文、不写 file_cache、无加载状态后缀。
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

type ChildEntry = { readonly kind: "dir" | "file"; readonly name: string };

function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * 根行标签：与 {@link workplaceFileTreeRootLabel} 口径一致——
 * `/` → `/`；其它 path → `basename/`（例 `/notes` → `notes/`）。
 */
function attachDirTreeRootLabel(rootDir: string): string {
  const normalized = rootDir.replace(/\/+$/, "") || "/";
  if (normalized === "/") {
    return "/";
  }
  const idx = normalized.lastIndexOf("/");
  const base = idx >= 0 ? normalized.slice(idx + 1) : normalized;
  return base.length > 0 ? `${base}/` : "/";
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
 * 渲染以 `rootDir` 为根的 depth=1 `$filetree` ASCII 树正文（**无**外层 `<dir>`）；
 * 超长截断并在树末追加 `[truncated]` 注释行。
 *
 * 例：
 * ```
 * notes/
 * ├── sub/
 * └── a.md
 * ```
 */
export async function renderDirAttachTree(
  rootDir: string,
  deps: RenderDirAttachTreeDeps,
): Promise<string> {
  const maxBytes = deps.maxUtf8Bytes ?? ATTACH_DIR_TREE_MAX_UTF8_BYTES;
  const normalizedRoot = rootDir.replace(/\/+$/, "") || "/";
  const rootLine = attachDirTreeRootLabel(normalizedRoot);

  let entries: Awaited<ReturnType<VfsService["list"]>>;
  try {
    entries = await deps.vfs.list(normalizedRoot, { recursive: false });
  } catch {
    // 目录不存在时仍输出根行，便于 prompt 侧感知路径
    return rootLine;
  }

  const dirs: ChildEntry[] = [];
  const files: ChildEntry[] = [];
  for (const e of entries) {
    if (e.kind === "directory") {
      dirs.push({ kind: "dir", name: entryDisplayName(e.path, "directory") });
    } else {
      files.push({ kind: "file", name: entryDisplayName(e.path, "file") });
    }
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  const children = [...dirs, ...files];

  // 根行 + 直子（├── / └──）；单层无需 │ 深层前缀；截断预算仅计树正文（不含外壳）
  const parts: string[] = [`${rootLine}\n`];
  let truncated = false;

  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const chunk = `${branch}${children[i]!.name}\n`;
    const next = parts.join("") + chunk;
    if (utf8ByteLength(next) > maxBytes) {
      truncated = true;
      break;
    }
    parts.push(chunk);
  }

  let treeBody = parts.join("").replace(/\n$/, "");
  if (truncated) {
    treeBody = `${treeBody}\n<!-- [truncated] -->`;
  }
  return treeBody;
}
