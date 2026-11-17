/**
 * 工具卡片 VFS 文件路径解析（**权威实现**：core `domain/tool/logic/vfs-tool-file-path.ts`
 * 的 `resolveVfsToolFilePath`；本文件是 WebView bundle 的镜像）。
 *
 * 镜像原因：core 该模块既未在 `packages/core/package.json` 的 exports 里暴露叶子
 * 子路径，也不在 webview 构建门 B 的 core 白名单（`scripts/build-webview.mjs` 的
 * `WEBVIEW_CORE_ALLOWLIST`）；经 `@novel-master/core/chat` barrel 引入会把整条闭包
 * 拉进 bundle，故不能直接 import。**镜像纪律**：工具名集合、`vfs.` 前缀剥离、
 * `path ?? file_path` 回落、`resolveLogicalPath` 规范化（trim / 补前导 `/` /
 * 折叠 `.` `..` / 越根拒绝）与返回通道（解析不出返回 `undefined`）都与 core 一致。
 */
import {VFS_FILE_TOOLS} from '../state/state';

export function normalizePathForToolCard(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    // nm-throw: keep — webview 沙箱内的路径校验，由调用的 tool 层 catch 成工具失败
    throw new Error('invalid path');
  }
  const normalized = path.replace(/\\/g, '/');
  if (normalized.charAt(0) !== '/') {
    // nm-throw: keep — webview 沙箱内的路径校验，由调用的 tool 层 catch 成工具失败
    throw new Error('invalid path');
  }
  const segments = normalized.split('/');
  const stack: string[] = [];
  for (let si = 0; si < segments.length; si++) {
    const segment = segments[si];
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (stack.length === 0) {
        // nm-throw: keep — 越根校验，沙箱内安全护栏
        throw new Error('path escapes above root');
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  if (stack.length === 0) {
    return '/';
  }
  return '/' + stack.join('/');
}

// nm-style: keep-public — 工具卡片跳转路径解析（ToolGroup 消费）
export function vfsToolFilePath(name: string, input: Record<string, unknown> | null | undefined): string | undefined {
  if (name.indexOf('vfs.') === 0) name = name.slice(4);
  if (!VFS_FILE_TOOLS[name]) return undefined;
  // Bug1 加固：与 core 镜像保持一致，兼容 file_path 字段名。
  const raw = input && (input.path ?? input.file_path);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.replace(/^\s+|\s+$/g, '');
  if (trimmed.length === 0) return undefined;
  try {
    return normalizePathForToolCard(trimmed.charAt(0) === '/' ? trimmed : '/' + trimmed);
  } catch {
    return undefined;
  }
}
