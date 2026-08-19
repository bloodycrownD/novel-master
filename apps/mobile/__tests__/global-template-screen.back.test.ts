import {
  isGhostPop,
  shouldInterceptBackRemove,
} from '../src/screens/stack/global-template-back';

/**
 * mobile/G-1 用例②：beforeRemove 拦截判定。
 *
 * 说明：这里以判定函数单测替代整屏渲染测试——拦截逻辑已全部收敛在
 * {@link shouldInterceptBackRemove} 纯函数中，GlobalTemplateScreen 内
 * 只剩薄封装；而整屏渲染需要真实 native-stack 导航器与手势路由环境
 * （jest 下模拟 beforeRemove 事件分发成本高且脆弱），故不做整屏测试。
 */
describe('GlobalTemplateScreen beforeRemove 拦截判定', () => {
  it('子目录 + POP（侧滑手势/返回）→ 拦截并转为逐级上翻', () => {
    expect(
      shouldInterceptBackRemove({actionType: 'POP', canGoUp: true}),
    ).toBe(true);
  });

  it('根目录 + POP → 放行（正常退出页面，不上翻）', () => {
    expect(
      shouldInterceptBackRemove({actionType: 'POP', canGoUp: false}),
    ).toBe(false);
  });

  it('子目录 + RESET / POP_TO_TOP / NAVIGATE → 放行（清栈导航不被吞成上翻）', () => {
    expect(
      shouldInterceptBackRemove({actionType: 'RESET', canGoUp: true}),
    ).toBe(false);
    expect(
      shouldInterceptBackRemove({actionType: 'POP_TO_TOP', canGoUp: true}),
    ).toBe(false);
    expect(
      shouldInterceptBackRemove({actionType: 'NAVIGATE', canGoUp: true}),
    ).toBe(false);
  });
});

describe('isGhostPop 幽灵 POP（侧滑返回时的手势残余）', () => {
  it('刚聚焦后窗口内的 POP → 判为残余，吞掉', () => {
    expect(
      isGhostPop({actionType: 'POP', focusedAtMs: 1000, nowMs: 1200}),
    ).toBe(true);
  });

  it('窗口外的 POP → 非残余（用户真实侧滑，正常处理）', () => {
    expect(
      isGhostPop({actionType: 'POP', focusedAtMs: 1000, nowMs: 2000}),
    ).toBe(false);
  });

  it('非 POP 动作永不判为残余（清栈导航始终放行）', () => {
    expect(
      isGhostPop({actionType: 'RESET', focusedAtMs: 1000, nowMs: 1001}),
    ).toBe(false);
  });
});
