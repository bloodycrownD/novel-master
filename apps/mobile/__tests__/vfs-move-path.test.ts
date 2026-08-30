import {describe, expect, it} from '@jest/globals';
import {
  isBlockedMoveTarget,
  isSelfOrAncestorPath,
  resolveMoveDestination,
} from '@/components/vfs/vfs-move-path';

describe('vfs-move-path', () => {
  it('resolveMoveDestination 保留 basename', () => {
    expect(resolveMoveDestination('/chap/a.md', '/out')).toBe('/out/a.md');
    expect(resolveMoveDestination('/chap/a.md', '/')).toBe('/a.md');
    expect(resolveMoveDestination('/dir', '/other')).toBe('/other/dir');
  });

  it('isSelfOrAncestorPath 识别自身与子树', () => {
    expect(isSelfOrAncestorPath('/a', '/a')).toBe(true);
    expect(isSelfOrAncestorPath('/a', '/a/b')).toBe(true);
    expect(isSelfOrAncestorPath('/a/b', '/a')).toBe(false);
    expect(isSelfOrAncestorPath('/a', '/b')).toBe(false);
  });

  it('isBlockedMoveTarget 任一源命中即拦截', () => {
    expect(isBlockedMoveTarget('/a/b', ['/a', '/x'])).toBe(true);
    expect(isBlockedMoveTarget('/y', ['/a', '/x'])).toBe(false);
  });
});
