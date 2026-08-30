/**
 * Step 6 / T-C12 入口：更多菜单「导入角色卡」源码契约（对齐 ZIP 测法）。
 *
 * 源码契约测豁免（tests/G-3）：VfsFileManager 是整屏文件管理器，渲染需要
 * runtime/VFS 列表/长按菜单/Alert 一整套链路，TestRenderer 行为化代价过高；
 * 本文件锁的是菜单项集合与 Alert 文案接线，周事维度由 vfs-file-manager.*
 * 系列 TestRenderer 测试覆盖，此处保留源码契约。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const root = join(__dirname, '..');

function readSrc(...parts: string[]): string {
  return readFileSync(join(root, ...parts), 'utf8');
}

describe('vfs character-card menu entry (Step 6)', () => {
  it('moreMenuItems 含「导入角色卡」且 Alert 复用 zipImportConfirmCopy', () => {
    const src = readSrc('src/components/vfs/VfsFileManager.tsx');
    expect(src).toContain("label: '导入角色卡'");
    expect(src).toContain("action: 'import-character-card'");
    // v1.4.21 起 ZIP/角色卡导入合并为 runImport(kind)：标题由 kind 派生，
    // Alert 正文仍复用 zipImportConfirmCopy（character-card-import spec 约定）。
    expect(src).toContain("kind === 'zip' ? '导入 ZIP' : '导入角色卡'");
    expect(src).toContain(
      'Alert.alert(title, zipImportConfirmCopy(targetPath)',
    );
    expect(src).toContain("'已导入角色卡'");
    expect(src).toContain('importCharacterCard(runtime, scope');
    expect(src).toContain('confirmed: true');
    expect(src).toContain('directoryPath: targetPath');
  });

  it('format-error 特判 CharacterCardError（对齐 VfsZipError）', () => {
    const src = readSrc('src/errors/format-error.ts');
    expect(src).toContain('CharacterCardError');
    expect(src).toMatch(
      /error instanceof VfsZipError[\s\S]*error instanceof CharacterCardError/,
    );
  });
});
