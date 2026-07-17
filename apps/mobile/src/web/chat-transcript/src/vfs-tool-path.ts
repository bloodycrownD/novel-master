// @ts-nocheck
import { VFS_FILE_TOOLS } from './state';
export function normalizePathForToolCard(path) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('invalid path');
    }
    var normalized = path.replace(/\\/g, '/');
    if (normalized.charAt(0) !== '/') {
      throw new Error('invalid path');
    }
    var segments = normalized.split('/');
    var stack = [];
    for (var si = 0; si < segments.length; si++) {
      var segment = segments[si];
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

export function resolveLogicalPathForToolCard(input) {
    var trimmed = String(input).replace(/^\s+|\s+$/g, '');
    if (trimmed.length === 0) {
      throw new Error('invalid path');
    }
    if (trimmed.charAt(0) === '/') {
      return normalizePathForToolCard(trimmed);
    }
    return normalizePathForToolCard('/' + trimmed);
  }

export function resolveVfsToolFilePath(name, input) {
    if (name.indexOf('vfs.') === 0) name = name.slice(4);
    if (!VFS_FILE_TOOLS[name]) return null;
    var raw = input && input.path;
    if (typeof raw !== 'string') return null;
    try {
      return resolveLogicalPathForToolCard(raw);
    } catch (e) {
      return null;
    }
  }

export function vfsToolFilePath(name, input) {
    return resolveVfsToolFilePath(name, input);
  }
