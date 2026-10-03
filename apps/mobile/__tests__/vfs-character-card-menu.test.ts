/**
 * T-MM1 / T-MM5 / T-MM2 入口：导入导出菜单收敛后的源码契约（菜单项同源常量 +
 * 第三张导入形式 sheet + 三分支文案独立）。
 *
 * 源码契约测豁免（tests/G-3）：VfsFileManager 是整屏文件管理器，渲染需要
 * runtime/VFS 列表/长按菜单/Alert 一整套链路，TestRenderer 行为化代价过高；
 * 本文件锁的是菜单项集合与 Alert 文案接线，周事维度由 vfs-file-manager.*
 * 系列 TestRenderer 测试覆盖（菜单项集合与 workplace 门控在
 * vfs-file-manager.session.integration.test.tsx 里行为化断言），此处保留源码契约。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const root = join(__dirname, '..');

function readSrc(...parts: string[]): string {
  return readFileSync(join(root, ...parts), 'utf8');
}

/**
 * 压掉换行与缩进后比对：跨行源码片段（多行三元、多行对象）逐字 toContain 太脆，
 * 排版一改就假红，这里统一归一空白后再断言接线。
 */
function flatSrc(...parts: string[]): string {
  return readSrc(...parts).replace(/\s+/g, ' ');
}

describe('vfs 导入导出菜单源码契约（vfs-import-export-menu / Step 5）', () => {
  it('T-MM1：「导入」「导出」为模块级同源常量，旧三项字面量全部退役', () => {
    const src = readSrc('src/components/vfs/VfsFileManager.tsx');
    // 同源常量：一份 items，行菜单与 more 菜单各引用一次。
    expect(src).toContain(
      "const IMPORT_MENU_ITEM: SheetMenuItem = {label: '导入', action: 'import'};",
    );
    expect(src).toContain(
      "const EXPORT_MENU_ITEM: SheetMenuItem = {label: '导出', action: 'export'};",
    );
    // 两处菜单各引用同源常量（不再是两套字面量）。
    expect(src.match(/EXPORT_MENU_ITEM,/g)?.length).toBe(3);
    expect(src.match(/IMPORT_MENU_ITEM,/g)?.length).toBe(2);
    // 旧三项（导出 ZIP / 导入 ZIP / 导入角色卡）与其 action 全部退役。
    expect(src).not.toContain("label: '导出 ZIP'");
    expect(src).not.toContain("label: '导入 ZIP'");
    expect(src).not.toContain("label: '导入角色卡'");
    expect(src).not.toContain("action: 'export-zip'");
    expect(src).not.toContain("action: 'import-zip'");
    expect(src).not.toContain("action: 'import-character-card'");
  });

  it('T-MM4：第三张 BottomSheetMenu 是导入形式三选（单文件 / ZIP 包 / 角色卡）', () => {
    const src = readSrc('src/components/vfs/VfsFileManager.tsx');
    expect(src).toContain("const IMPORT_FORM_SHEET_TITLE = '导入';");
    expect(src).toContain('const IMPORT_FORM_SHEET_ITEMS: SheetMenuItem[] = [');
    expect(src).toContain("{label: '单文件', action: 'file'}");
    expect(src).toContain("{label: 'ZIP 包', action: 'zip'}");
    expect(src).toContain("{label: '角色卡', action: 'character-card'}");
    // 三张 sheet 同时在场（第三张 visible 绑 importSheetTarget）。
    expect(src.match(/<BottomSheetMenu/g)?.length).toBe(3);
    expect(src).toContain('visible={!readOnly && importSheetTarget != null}');
    expect(src).toContain('title={IMPORT_FORM_SHEET_TITLE}');
    // readOnly 下三项 sheet items 必须为空（只读屏不留写入口）。
    const flat = flatSrc('src/components/vfs/VfsFileManager.tsx');
    expect(flat).toContain(
      'const importFormSheetItems: SheetMenuItem[] = readOnly ? [] : IMPORT_FORM_SHEET_ITEMS;',
    );
    // 新 state 进 dismissAllOverlays，切 Tab 不残留。
    expect(flat).toContain('setImportSheetTarget(null); vfsBatchExit();');
  });

  it('T-MM5：导入三种形式的确认文案各自独立（zip / 角色卡 / 单文件）', () => {
    const src = readSrc('src/components/vfs/VfsFileManager.tsx');
    const flat = flatSrc('src/components/vfs/VfsFileManager.tsx');
    expect(src).toContain('function zipImportConfirmCopy(path: string)');
    expect(src).toContain('function characterCardImportConfirmCopy(path: string)');
    expect(src).toContain(
      'function singleFileImportConfirmCopy(conflictCount: number)',
    );
    // 三份文案语义各异：ZIP 覆盖全部文件、角色卡只覆盖同名角色卡、单文件报数量。
    expect(src).toContain('下的全部文件，同级其他内容不受影响');
    expect(src).toContain('下的同名角色卡文件，同级其他文件不受影响');
    expect(src).toContain('目标处已有 ${conflictCount} 个同名文件，覆盖后不可撤销');
    // runImport 按 kind 选文案（不再与角色卡共用 zipImportConfirmCopy）。
    expect(flat).toContain(
      "kind === 'zip' ? zipImportConfirmCopy(targetPath) : characterCardImportConfirmCopy(targetPath);",
    );
    expect(src).toContain('Alert.alert(title, confirmCopy, [');
    expect(src).toContain("'ZIP 导入完成'");
    expect(src).toContain("'已导入角色卡'");
    // 单文件分支独立 Alert：needs-confirm 才问，确认回调走服务挂上来的 confirm。
    expect(flat).toContain(
      "'导入单文件', singleFileImportConfirmCopy(conflictCount),",
    );
    expect(src).toContain('const {conflictCount, confirm} = result;');
    expect(src).toContain('const applied = await confirm();');
    expect(flat).toContain(
      'importVfsSingleFile(runtime, scope, { targetDir: targetPath, });',
    );
    // 二进制跳过明示（D6）。
    expect(src).toContain('跳过 ${skippedBinary.length} 个非 UTF-8 文件');
  });

  it('T-MM2/T-MM5：导出按行类型分流，单文件导出与 ZIP 共用 exporting 守卫', () => {
    const src = readSrc('src/components/vfs/VfsFileManager.tsx');
    const flat = flatSrc('src/components/vfs/VfsFileManager.tsx');
    // 行菜单：file → 单文件导出，dir → ZIP 导出（分流注释在两行之间，用正则）。
    expect(flat).toMatch(
      /if \(action === 'export'\) \{[\s\S]*?if \(menuRow\.kind === 'file'\) \{ runExportFile\(menuPath\); \} else \{ runExportZip\(menuPath\); \}/,
    );
    // more 菜单只出现在目录列表，目标恒为当前目录 → ZIP。
    expect(flat).toContain('runExportZip(currentPath);');
    // 守卫改名 exporting：ZIP 与单文件互斥防重入。
    expect(src).not.toContain('exportingZip');
    expect(flat.match(/if \(exporting\) \{ return; \}/g)?.length).toBe(2);
    expect(src).toContain('exportVfsSingleFile(runtime, scope, logicalPath)');
    expect(src).toContain("showToast('文件已保存到所选位置')");
    expect(src).toContain("showToast('ZIP 已保存到所选位置')");
  });

  it('format-error 特判 CharacterCardError（对齐 VfsZipError）', () => {
    const src = readSrc('src/errors/format-error.ts');
    expect(src).toContain('CharacterCardError');
    expect(src).toMatch(
      /error instanceof VfsZipError[\s\S]*error instanceof CharacterCardError/,
    );
  });
});