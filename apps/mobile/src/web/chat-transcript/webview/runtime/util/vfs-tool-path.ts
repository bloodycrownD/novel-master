import {VFS_FILE_TOOLS} from '../state/state';

export function normalizePathForToolCard(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error('invalid path');
  }
  const normalized = path.replace(/\\/g, '/');
  if (normalized.charAt(0) !== '/') {
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

export function resolveLogicalPathForToolCard(input: unknown): string {
  const trimmed = String(input).replace(/^\s+|\s+$/g, '');
  if (trimmed.length === 0) {
    throw new Error('invalid path');
  }
  if (trimmed.charAt(0) === '/') {
    return normalizePathForToolCard(trimmed);
  }
  return normalizePathForToolCard('/' + trimmed);
}

export function resolveVfsToolFilePath(
  name: string,
  input: Record<string, unknown> | null | undefined,
): string | null {
  if (name.indexOf('vfs.') === 0) name = name.slice(4);
  if (!VFS_FILE_TOOLS[name]) return null;
  // Bug1 加固：与 core 镜像保持一致，兼容 file_path 字段名。
  const raw = input && (input.path ?? input.file_path);
  if (typeof raw !== 'string') return null;
  try {
    return resolveLogicalPathForToolCard(raw);
  } catch {
    return null;
  }
}

export function vfsToolFilePath(
  name: string,
  input: Record<string, unknown> | null | undefined,
): string | null {
  return resolveVfsToolFilePath(name, input);
}
