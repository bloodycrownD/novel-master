/**
 * VfsPromptModal 宽度契约（regression: 新建文件/文件夹弹窗宽度塌成内容宽）。
 * 背景：ModalShell center 容器带 alignItems:'center'（子元素收缩包裹），
 * VfsPromptModal 的 promptBox 迁移时未声明宽度，弹窗缩到与 placeholder 同宽。
 * 旧实现（VfsFileManager 内联版）的容器无 alignItems，交叉轴默认 stretch 撑宽。
 * 注：与 modal-shell-variant 同款源码契约手法（渲染链含懒加载模块，TestRenderer 不稳）。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const src = readFileSync(
  join(__dirname, '../src/components/vfs/vfs-file-manager/VfsPromptModal.tsx'),
  'utf8',
);

describe('VfsPromptModal 宽度契约（regression: 弹窗宽度塌陷）', () => {
  it('promptBox 显式声明 width，防止 center 容器 alignItems 收缩包裹', () => {
    expect(src).toMatch(/promptBox:\s*\{[^}]*width:\s*'100%'/);
  });
});
