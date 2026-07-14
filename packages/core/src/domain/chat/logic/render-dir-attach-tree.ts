/**
 * `@` 目录附件：递归渲染嵌套 `<dir>` / `<file>` 树（禁止顶层展平）。
 *
 * @module domain/chat/logic/render-dir-attach-tree
 */

import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
  type WorkplaceDisplayStatus,
} from "@/domain/session-kkv/model/session-kkv-domains.js";
import {
  parseFileCachePayload,
  serializeFileCachePayload,
} from "@/domain/worktree/logic/rule-snapshot-codec.js";
import { renderFileBlock } from "@/domain/worktree/logic/worktree-display.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";
import type { SessionKkvService } from "@/service/session-kkv/session-kkv.port.js";
import { isBinaryAttachPath } from "./attach-binary-heuristic.js";

/** 单次目录树拼装 UTF-8 上限（SPEC：512KiB）。 */
export const ATTACH_DIR_TREE_MAX_UTF8_BYTES = 512 * 1024;

/** {@link renderDirAttachTree} 依赖。 */
export interface RenderDirAttachTreeDeps {
  readonly sessionId: string;
  readonly sessionKkv: SessionKkvService;
  readonly vfs: VfsService;
  /** 覆盖截断阈值（单测用）；默认 {@link ATTACH_DIR_TREE_MAX_UTF8_BYTES}。 */
  readonly maxUtf8Bytes?: number;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
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

type DirNode = {
  readonly path: string;
  readonly dirs: Map<string, DirNode>;
  readonly files: string[];
};

function ensureDir(root: DirNode, dirPath: string): DirNode {
  const parts = dirPath
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter((p) => p.length > 0);
  let node = root;
  let acc = "";
  for (const part of parts) {
    acc = `${acc}/${part}`;
    let next = node.dirs.get(part);
    if (next == null) {
      next = { path: acc, dirs: new Map(), files: [] };
      node.dirs.set(part, next);
    }
    node = next;
  }
  return node;
}

/**
 * 将扁平 list 结果建为嵌套树（以 `rootDir` 为根）。
 */
function buildDirTree(
  rootDir: string,
  entries: readonly { readonly path: string; readonly kind: "file" | "directory" }[],
): DirNode {
  const rootPath = rootDir.replace(/\/+$/, "") || "/";
  const root: DirNode = { path: rootPath, dirs: new Map(), files: [] };
  const rootPrefix = rootPath === "/" ? "/" : `${rootPath}/`;

  for (const entry of entries) {
    if (entry.kind === "directory") {
      if (entry.path === rootPath || entry.path === withTrailingSlash(rootPath)) {
        continue;
      }
      if (rootPath !== "/" && !entry.path.startsWith(rootPrefix)) {
        continue;
      }
      ensureDir(root, entry.path);
      continue;
    }
    if (rootPath !== "/" && !entry.path.startsWith(rootPrefix)) {
      continue;
    }
    if (rootPath === "/" && !entry.path.startsWith("/")) {
      continue;
    }
    const parent =
      entry.path.lastIndexOf("/") <= 0
        ? "/"
        : entry.path.slice(0, entry.path.lastIndexOf("/")) || "/";
    const dirNode =
      parent === rootPath || parent === "/"
        ? root
        : ensureDir(root, parent);
    dirNode.files.push(entry.path);
  }

  return root;
}

async function loadLeafFileBlock(
  path: string,
  deps: RenderDirAttachTreeDeps,
): Promise<string> {
  const status: WorkplaceDisplayStatus = isBinaryAttachPath(path)
    ? "filename"
    : "full";
  const key = fileCacheKey(status, path);
  const cachedRaw = await deps.sessionKkv.get(
    deps.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
  );
  if (cachedRaw != null) {
    const parsed = parseFileCachePayload(cachedRaw);
    if (parsed != null) {
      return renderFileBlock({
        logicalPath: path,
        mtimeMs: parsed.mtimeMs,
        display: status,
        content: parsed.body,
      });
    }
  }

  let body = "";
  let mtimeMs = 0;
  if (status === "filename") {
    body = "";
    mtimeMs = 0;
  } else {
    try {
      const result = await deps.vfs.read(path);
      body = result.content;
      mtimeMs = result.mtimeMs;
    } catch {
      body = "(missing)";
      mtimeMs = 0;
    }
  }

  await deps.sessionKkv.set(
    deps.sessionId,
    SESSION_KKV_DOMAIN_FILE_CACHE,
    key,
    serializeFileCachePayload({ body, mtimeMs }),
  );

  return renderFileBlock({
    logicalPath: path,
    mtimeMs,
    display: status,
    content: body,
  });
}

/**
 * 渲染以 `rootDir` 为根的嵌套目录树；超长截断并在末尾追加 `[truncated]` 注释行。
 */
export async function renderDirAttachTree(
  rootDir: string,
  deps: RenderDirAttachTreeDeps,
): Promise<string> {
  const maxBytes = deps.maxUtf8Bytes ?? ATTACH_DIR_TREE_MAX_UTF8_BYTES;
  const normalizedRoot = rootDir.replace(/\/+$/, "") || "/";
  let entries: Awaited<ReturnType<VfsService["list"]>>;
  try {
    entries = await deps.vfs.list(normalizedRoot, { recursive: true });
  } catch {
    const emptyPath = withTrailingSlash(normalizedRoot);
    return `<dir path="${escapeXmlAttr(emptyPath)}">\n</dir>`;
  }

  const tree = buildDirTree(normalizedRoot, entries);
  const parts: string[] = [];
  let truncated = false;

  const append = (chunk: string): boolean => {
    const next = parts.join("") + chunk;
    if (utf8ByteLength(next) > maxBytes) {
      truncated = true;
      return false;
    }
    parts.push(chunk);
    return true;
  };

  const renderNode = async (node: DirNode, depth: number): Promise<boolean> => {
    const dirPath = withTrailingSlash(node.path);
    const indent = "  ".repeat(depth);
    if (!append(`${indent}<dir path="${escapeXmlAttr(dirPath)}">\n`)) {
      return false;
    }

    const filePaths = [...node.files].sort();
    for (const filePath of filePaths) {
      const block = await loadLeafFileBlock(filePath, deps);
      const indented = block
        .split("\n")
        .map((line) => `${indent}  ${line}`)
        .join("\n");
      if (!append(`${indented}\n`)) {
        return false;
      }
    }

    const dirKeys = [...node.dirs.keys()].sort();
    for (const key of dirKeys) {
      const child = node.dirs.get(key)!;
      if (!(await renderNode(child, depth + 1))) {
        return false;
      }
    }

    if (!append(`${indent}</dir>\n`)) {
      return false;
    }
    return true;
  };

  await renderNode(tree, 0);
  let out = parts.join("").replace(/\n$/, "");
  if (truncated) {
    out = `${out}\n<!-- [truncated] -->`;
  }
  return out;
}
