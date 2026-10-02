/**
 * T-FEPar-3：FileEditor 保存回调的模块级单例语义。
 *
 * 病灶（N-P1-03）：`onSessionVfsSaved?: () => void` 被放进 FileEditor 路由
 * params —— 双重违规：① 不可序列化（RN 写 state 时丢弃），② 8 个 navigate
 * 调用点一处都没传它 ⇒ 恒 no-op，session 域保存成功后工作区列表不刷新。
 *
 * 观测面是「take 的返回值」，不依赖 UI 文案。
 * （T-FEPar-4 的接线断言在 open-file-editor-refresh.test.ts：jest 是 CJS，
 *  动态 import 需要 --experimental-vm-modules，故接线用例独立成文件用静态 import。）
 */
import {describe, expect, it, jest, beforeEach} from '@jest/globals';
import {
  setFileEditorOnSessionVfsSaved,
  takeFileEditorOnSessionVfsSaved,
} from '@/components/agent/file-editor-saved-callback';

describe('file-editor-saved-callback 单例语义', () => {
  beforeEach(() => {
    // 清干净上一个用例可能残留的回调
    takeFileEditorOnSessionVfsSaved();
  });

  it('T-FEPar-3 take 语义：回调取走即清，第二次取为 null', () => {
    const cb1 = jest.fn();
    setFileEditorOnSessionVfsSaved(cb1);
    expect(takeFileEditorOnSessionVfsSaved()).toBe(cb1);
    // 取走即清：避免上一次打开的回调泄漏到下一次
    expect(takeFileEditorOnSessionVfsSaved()).toBeNull();
  });

  it('T-FEPar-3 写入覆盖：后写覆盖先写', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    setFileEditorOnSessionVfsSaved(cb1);
    setFileEditorOnSessionVfsSaved(cb2);
    expect(takeFileEditorOnSessionVfsSaved()).toBe(cb2);
  });
});
