/**
 * UI 等价性回归契约（cr-fix-spec ui-parity：组件收敛第二轮专项）。
 * 锁定迁移组件还原后的关键样式语义，防止再次被统一收敛悄悄改掉：
 * - TextPromptModal 双变体间距（center 标题 mb12 / bottom actions 总间距 16）
 * - AnnotatePickModal 遮罩 0.45 / VfsPromptModal 无 KAV offset（还原 4ba1c73 行为）
 * - SkillPicker 面板观感（80% / 圆角 16 / 取消色主文字色）
 * - EditorScreenShell 标题字号默认 13、文件屏显式 14
 * 注：源码契约手法（readFileSync + regex），与 modal-shell-variant 同款。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('TextPromptModal 双变体间距（regression: center 标题贴死 / bottom actions 24）', () => {
  const src = read('src/components/ui/TextPromptModal.tsx');

  it('titleCenter 含 marginBottom:12（旧居中版值），bottom 的 title 无 marginBottom', () => {
    expect(src).toMatch(/titleCenter:\s*\{[^}]*marginBottom:\s*12,?\s*\}/);
    expect(src).toMatch(
      /title:\s*\{\s*fontSize:\s*18,\s*fontWeight:\s*'600',\s*textAlign:\s*'center',?\s*\}/,
    );
  });

  it('panelCenter 不设 gap（否则 actions 段间距会叠成 20）', () => {
    const panelCenter = src.match(/panelCenter:\s*\{[^}]*\}/)?.[0] ?? '';
    expect(panelCenter).not.toMatch(/gap/);
  });

  it('actions 拆变体：bottom marginTop 0（gap8+input mb8=16），center marginTop 8', () => {
    expect(src).toMatch(/actionsBottom:\s*\{[^}]*marginTop:\s*0,?\s*\}/);
    expect(src).toMatch(/actionsCenter:\s*\{[^}]*marginTop:\s*8,?\s*\}/);
    expect(src).toMatch(
      /isBottom \? styles\.actionsBottom : styles\.actionsCenter/,
    );
  });
});

describe('弹窗遮罩与键盘避让还原（4ba1c73 等价）', () => {
  it('AnnotatePickModal 遮罩 0.45（ModalShell 默认 0.4 会变浅）', () => {
    expect(read('src/components/vfs/AnnotatePickModal.tsx')).toMatch(
      /backdropOpacity=\{0\.45\}/,
    );
  });

  it('VfsPromptModal 不传 keyboardVerticalOffset（旧实现为默认 0）', () => {
    expect(
      read('src/components/vfs/vfs-file-manager/VfsPromptModal.tsx'),
    ).not.toMatch(/keyboardVerticalOffset/);
  });
});

describe('SkillPicker 面板观感还原', () => {
  it('sheetOverride：maxHeight 80% + 圆角 16', () => {
    const src = read('src/components/skills/SkillPicker.tsx');
    expect(src).toMatch(/maxHeight:\s*'80%'/);
    expect(src).toMatch(/borderTopLeftRadius:\s*16/);
    expect(src).toMatch(/cancelColor=\{tokens\.text\}/);
  });

  it('PickerListModal 透传 sheetStyle 叠加与 cancelColor 默认', () => {
    const src = read('src/components/ui/PickerListModal.tsx');
    expect(src).toMatch(/panelStyle=\{\[styles\.sheet, sheetStyle\]\}/);
    expect(src).toMatch(/cancelColor \?\? tokens\.textSecondary/);
  });
});

describe('EditorScreenShell 标题字号', () => {
  it('shell 默认 13，文件屏显式还原 14', () => {
    expect(read('src/components/chrome/EditorScreenShell.tsx')).toMatch(
      /titleFontSize = 13/,
    );
    expect(read('src/screens/stack/FileEditorScreen.tsx')).toMatch(
      /titleFontSize=\{14\}/,
    );
  });
});
