import {describe, expect, it} from '@jest/globals';
import {VfsMovePath} from '@/components/vfs/vfs-move-path';

describe('vfs-move-path', () => {
    it('resolveMoveDestination 保留 basename', () => {
        expect(VfsMovePath.resolveMoveDestination('/chap/a.md', '/out')).toBe('/out/a.md');
        expect(VfsMovePath.resolveMoveDestination('/chap/a.md', '/')).toBe('/a.md');
        expect(VfsMovePath.resolveMoveDestination('/dir', '/other')).toBe('/other/dir');
    });

    it('isSelfOrAncestorPath 识别自身与子树', () => {
        expect(VfsMovePath.isSelfOrAncestorPath('/a', '/a')).toBe(true);
        expect(VfsMovePath.isSelfOrAncestorPath('/a', '/a/b')).toBe(true);
        expect(VfsMovePath.isSelfOrAncestorPath('/a/b', '/a')).toBe(false);
        expect(VfsMovePath.isSelfOrAncestorPath('/a', '/b')).toBe(false);
    });

    it('isBlockedMoveTarget 任一源命中即拦截', () => {
        expect(VfsMovePath.isBlockedMoveTarget('/a/b', ['/a', '/x'])).toBe(true);
        expect(VfsMovePath.isBlockedMoveTarget('/y', ['/a', '/x'])).toBe(false);
    });
});
