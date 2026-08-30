/**
 * ModalShell variant 布局契约（regression: 项目抽屉打开看不见）。
 * 背景：left variant 曾错误复用 bottom 的纵向容器（flex-end），左抽屉面板
 * 高度塌陷并被推到屏幕底部，表现为「打开看不见」。
 * 注：ModalShell 渲染链含懒加载模块，TestRenderer 下不稳定，故采用源码契约测
 * （与 webview boot-script 系列同款手法）——断言 variant→容器样式的映射与
 * left 样式定义存在且为横向布局。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

const src = readFileSync(
  join(__dirname, '../src/components/ui/ModalShell.tsx'),
  'utf8',
);

describe('ModalShell variant 布局（regression: 项目抽屉不可见）', () => {
  it('left 样式定义为横向布局（flexDirection: row）', () => {
    expect(src).toMatch(
      /left:\s*\{\s*flex:\s*1,\s*flexDirection:\s*'row',?\s*\}/,
    );
  });

  it('containerStyleList 按 center/left/bottom 三分派，left 不再落入 bottom 分支', () => {
    // 三元链：center → left → bottom（left 必须独立分支，不能与 bottom 共享）
    expect(src).toMatch(
      /variant === 'center'\s*\?\s*styles\.center\s*:\s*variant === 'left'\s*\?\s*styles\.left\s*:\s*styles\.bottom/,
    );
  });

  it('leftBackdrop 为遮罩（flex:1，与 drawer 同层横向排布）', () => {
    expect(src).toMatch(/leftBackdrop:\s*\{\s*flex:\s*1,?\s*\}/);
  });
});
