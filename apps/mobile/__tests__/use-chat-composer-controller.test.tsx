/**
 * `useChatComposerController` 行为测试（chat-webview-unify Step 7）。
 *
 * 断言面按 spec §composerState 字段表 + §RN 侧组件重组接口表挑**本 hook 独有**的部分
 * （`ChatConversationWebView` 的下行协议由 `chat-conversation-webview.test.tsx` 覆盖，
 * 宿主与 controller 的接线由 `chat-conversation-panel.integration.test.tsx` 覆盖）：
 * - `send` 三分支路由（needModel / 空输入 canResume 续跑 / 正常发送）+ `terminate`；
 * - 键盘态 `keyboardUp` 的布尔翻转（**不**每帧刷 state——只断言翻转结果与翻转次数）；
 * - `change` 落库（纪律 A）：打字与 **命令式写入补发**（粘贴上屏）走同
 *   一条消费口，不区分来源；
 * - Picker 路径 token 插入经 **M7 命令式通道**下发，且带选区（不是 effect 版 setText）。
 *
 * （typeahead 候选源拉取与引用稳定两组用例随 2026-10 迭代 typeahead 浮层链移除
 * 而退役——候选源已无消费方。）
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {__setKeyboardHeightForTests} from '../test-utils/react-native-keyboard-controller-mock';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 24, left: 0, right: 0}),
}));

// 打点桩：本文件只关心行为，run-timing 的 console 输出会把断言日志淹掉。
jest.mock('../src/debug/run-timing', () => ({
  resetRunTiming: () => undefined,
  timingLog: () => undefined,
  resetRollbackTiming: () => undefined,
  rollbackTimingLog: () => undefined,
  bootTimingLog: () => undefined,
}));

const mockProjectComposerStatus = jest.fn(async () => [] as unknown[]);
jest.mock('../src/services/project-composer-status.service', () => ({
  projectComposerStatusForSession: (...args: unknown[]) =>
    mockProjectComposerStatus(...(args as [])),
}));

const mockStartRun = jest.fn(
  (..._args: unknown[]) => ({ok: true}) as {ok: boolean; error?: string},
);
const mockStopRun = jest.fn();

const mockRuntime: Record<string, any> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

import {
  useChatComposerController,
  type ChatComposerController,
  type UseChatComposerControllerOptions,
} from '../src/components/chat/useChatComposerController';
import {
  applyComposerStatusAttachmentsReplace,
  clearChatComposerDraft,
  readChatComposerDraftState,
  writeChatComposerDraft,
} from '../src/storage/chat-composer-draft';
import {
  resetChatAnnotateDraftStoreForTests,
} from '@novel-master/core/chat';

type Mutable<T> = {-readonly [K in keyof T]: T[K]};

let latest: Mutable<ChatComposerController> | null = null;
/** **当前这棵树**的渲染次数（键盘态用例要断言「翻转才重渲染」）。 */
let latestRenderCount = 0;
const mountedTrees: TestRenderer.ReactTestRenderer[] = [];

function Harness(props: Partial<UseChatComposerControllerOptions>) {
  const options: UseChatComposerControllerOptions = {
    scope: {projectId: 'p1', sessionId: 's1'},
    hasModel: true,
    running: false,
    onMessagesChanged: () => undefined,
    onNeedModel: () => undefined,
    canResumeWithoutInput: false,
    lastMessageIsPlainUserText: false,
    ...props,
  };
  const renderCountRef = React.useRef(0);
  renderCountRef.current += 1;
  const controller = useChatComposerController(options);
  latest = controller as Mutable<ChatComposerController>;
  latestRenderCount = renderCountRef.current;
  return null;
}

function current(): Mutable<ChatComposerController> {
  if (latest == null) {
    throw new Error('controller 未挂载');
  }
  return latest;
}

async function mount(
  props: Partial<UseChatComposerControllerOptions> = {},
): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<Harness {...props} />);
  });
  // 必须登记并在 afterEach 卸载：草稿 store / 单元 manager / mock 函数都是**模块级
  // 单例**，上一棵没卸载的树会继续订阅、继续重渲染，并把模块级 `latest` 抢走——
  // 症状是「单跑绿、全跑红」，且红的位置和真正的缺陷毫无关系。
  mountedTrees.push(tree);
  await flush();
  return tree;
}

/** 冲净 effect 与异步批（real timers）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
  });
}

/** 草稿的 DB 侧窄口（回填链要「写后读」一致，故必须真有存储，不能恒返回 null）。 */
const mockDraftDb = new Map<string, string | null>();

beforeEach(() => {
  latest = null;
  latestRenderCount = 0;
  mockDraftDb.clear();
  mockStartRun.mockClear().mockImplementation(() => ({ok: true}));
  mockStopRun.mockClear();
  mockProjectComposerStatus.mockReset().mockResolvedValue([]);
  clearChatComposerDraft('s1');
  resetChatAnnotateDraftStoreForTests();
  __setKeyboardHeightForTests(0);
  Object.assign(mockRuntime, {
    preferences: {getLlmStreamEnabled: jest.fn(async () => true)},
    sessions: {
      get: jest.fn(async () => ({id: 's1', projectId: 'p1'})),
      getComposerDraftJson: jest.fn(
        async (id: string) => mockDraftDb.get(id) ?? null,
      ),
      setComposerDraftJson: jest.fn(
        async (id: string, json: string | null) => {
          mockDraftDb.set(id, json);
          return true;
        },
      ),
    },
    sessionStreamUnitManager: {
      startRun: mockStartRun,
      stopRun: mockStopRun,
    },
  });
});

afterEach(async () => {
  for (const tree of mountedTrees.splice(0)) {
    await act(async () => {
      tree.unmount();
    });
  }
  __setKeyboardHeightForTests(0);
});

describe('useChatComposerController · send 三分支路由', () => {
  it('无模型：send 落到 onNeedModel，不起 run', async () => {
    const onNeedModel = jest.fn();
    await mount({hasModel: false, onNeedModel});

    await act(async () => {
      current().handleDockAction('send');
    });

    expect(onNeedModel).toHaveBeenCalledTimes(1);
    expect(mockStartRun).not.toHaveBeenCalled();
    // hintRow 的显隐判据是 hasModel（不是 inputDisabled）：无模型即显示提示行。
    expect(current().composerState.hasModel).toBe(false);
    expect(current().composerState.inputDisabled).toBe(true);
  });

  it('空输入 + 可续跑：走空续跑分支（allowResumeWithoutInput=true）', async () => {
    await mount({canResumeWithoutInput: true});

    await act(async () => {
      current().handleDockAction('send');
    });

    expect(mockStartRun).toHaveBeenCalledTimes(1);
    const args = mockStartRun.mock.calls[0]!;
    expect(args[0]).toBe('s1');
    expect(args[1]).toBe('p1');
    expect(args[2]).toBe('');
    expect((args[3] as {allowResumeWithoutInput: boolean})
      .allowResumeWithoutInput).toBe(true);
  });

  it('有正文：正常发送（content 为 trim 后正文，allowResume=false）', async () => {
    await mount({canResumeWithoutInput: false});

    await act(async () => {
      current().onChangeText('  你好  ');
    });
    await act(async () => {
      current().handleDockAction('send');
    });

    expect(mockStartRun).toHaveBeenCalledTimes(1);
    const args = mockStartRun.mock.calls[0]!;
    expect(args[2]).toBe('你好');
    expect((args[3] as {allowResumeWithoutInput: boolean})
      .allowResumeWithoutInput).toBe(false);
  });

  it('空输入 + 不可续跑：既不 needModel 也不起 run', async () => {
    const onNeedModel = jest.fn();
    await mount({canResumeWithoutInput: false, onNeedModel});

    await act(async () => {
      current().handleDockAction('send');
    });

    expect(onNeedModel).not.toHaveBeenCalled();
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it('running 态：send 与 terminate 都落到 stopRun', async () => {
    await mount({running: true});

    await act(async () => {
      current().handleDockAction('terminate');
    });
    await act(async () => {
      current().handleDockAction('send');
    });

    expect(mockStopRun).toHaveBeenCalledTimes(2);
    expect(mockStopRun).toHaveBeenCalledWith('s1');
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it('末条纯文本态：有正文也不发', async () => {
    await mount({lastMessageIsPlainUserText: true});
    await act(async () => {
      current().onChangeText('接着写');
    });
    await act(async () => {
      current().handleDockAction('send');
    });

    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it('manager 拒绝：error 进 composerState（dock 顶部报错行）', async () => {
    // manager.startRun 是**同步**返回受理结果的（不是 Promise）——mock 成 async
    // 会让 `started.ok` 读成 undefined，把「拒绝」误判成「受理成功但无 ok」。
    mockStartRun.mockImplementation(() => ({
      ok: false,
      error: '同会话已有 run',
    }));
    await mount();
    await act(async () => {
      current().onChangeText('hi');
    });
    await act(async () => {
      current().handleDockAction('send');
    });
    await flush();

    expect(current().composerState.error).toBe('同会话已有 run');
  });
});

describe('useChatComposerController · keyboardUp 派生', () => {
  it('键盘弹起/收起各翻转一次，且不逐帧刷 state', async () => {
    await mount();
    expect(current().composerState.keyboardUp).toBe(false);
    const rendersBefore = latestRenderCount;

    await act(async () => {
      __setKeyboardHeightForTests(-300);
    });
    expect(current().composerState.keyboardUp).toBe(true);

    await act(async () => {
      __setKeyboardHeightForTests(-310);
    });
    expect(current().composerState.keyboardUp).toBe(true);

    await act(async () => {
      __setKeyboardHeightForTests(0);
    });
    expect(current().composerState.keyboardUp).toBe(false);

    // 5 次注入、2 次真实翻转 → 渲染次数只按翻转增长（+1 挂载）。
    // 逐帧读 SharedValue 的写法会让这里等于注入次数。
    expect(latestRenderCount - rendersBefore).toBeLessThanOrEqual(2);
  });
});

describe('useChatComposerController · change 落库（纪律 A）', () => {
  it('打字 change 落草稿', async () => {
    await mount();
    await act(async () => {
      current().onChangeText('hello');
    });

    expect(readChatComposerDraftState('s1').text).toBe('hello');
    expect(current().text).toBe('hello');
  });

  it('命令式写入补发的 change（粘贴上屏）同样落库——不区分来源', async () => {
    await mount();
    // 这条上行在真机上来自 NativeChatComposer 的 M7 写入补发（粘贴落文），
    // RN 侧完全无从知道来源，只能靠「同一个消费口」保证它落库。
    await act(async () => {
      current().onChangeText('看这里 $写作 ');
    });

    expect(readChatComposerDraftState('s1').text).toBe('看这里 $写作 ');
  });

  it('同值回声（命令式写入后宿主的 onComposerChangeText）不重复落库', async () => {
    const setComposerText = jest.fn();
    await mount({setComposerText});
    await act(async () => {
      current().onChangeText('abc');
    });
    const persisted = mockRuntime.sessions.setComposerDraftJson;
    persisted.mockClear();

    // 宿主 M7 通道写完会回调 onComposerChangeText(text) —— 同值，必须早退。
    await act(async () => {
      current().onChangeText('abc');
    });

    expect(persisted).not.toHaveBeenCalled();
    expect(current().text).toBe('abc');
  });

  it('全屏回填链：写草稿 + bump draftRestoreToken → 文本被拉回（再经宿主下发）', async () => {
    // 这条就是 ChatTabScreen 的 ⛶ 退出回填链：`writeChatComposerDraft` **不**广播
    // 订阅（只有水化 / 状态条整表替换才广播），真正的重读驱动是
    // `draftRestoreToken` 递增——水化 effect 把它列在依赖里。测试照这条链走，
    // 别用「指望 writeChatComposerDraft 广播」写，那条路根本不存在。
    const tree = await mount();
    await act(async () => {
      writeChatComposerDraft('s1', '回填后的文本', mockRuntime.sessions);
    });
    await act(async () => {
      tree.update(<Harness draftRestoreToken={1} />);
    });
    await flush();

    expect(readChatComposerDraftState('s1').text).toBe('回填后的文本');
    expect(current().text).toBe('回填后的文本');
  });

  it('状态条整表替换（applyComposerStatusAttachmentsReplace）经订阅链同步 chips', async () => {
    await mount();
    await act(async () => {
      writeChatComposerDraft('s1', 'x');
      applyComposerStatusAttachmentsReplace({
        sessionId: 's1',
        attachments: [
          {
            id: 'c1',
            source: 'workplace',
            action: 'read',
            label: '工作区文件',
          } as never,
        ],
      });
    });
    await flush();

    expect(current().composerState.chips.map(c => c.id)).toEqual(['c1']);
  });
});

describe('useChatComposerController · Picker 路径（M7 命令式通道）', () => {
  it('`@` 选择器确认：插入 token 并经 setComposerText 下发（带光标）', async () => {
    const setComposerText = jest.fn();
    await mount({setComposerText});
    await act(async () => {
      current().onChangeText('看这里');
      current().onSelectionChange({start: 3, end: 3});
    });

    await act(async () => {
      current().handleDockAction('atPicker');
    });
    expect(current().pickerOpen).toBe(true);

    await act(async () => {
      current().onAtPickerConfirm(['@docs/a.md']);
    });

    expect(setComposerText).toHaveBeenCalledTimes(1);
    const [text, cursor] = setComposerText.mock.calls[0]!;
    expect(text).toBe('看这里 @docs/a.md ');
    expect(cursor).toBe((text as string).length);
    expect(readChatComposerDraftState('s1').text).toBe('看这里 @docs/a.md ');
    expect(current().pickerOpen).toBe(true); // 关闭由宿主 Modal 自己驱动
    // 插入咽喉点（CR-fix-04）：落文同时登记插入 token 的确认区间——
    // '@docs/a.md' 落在 [4, 14)（'看这里 ' 之后），打字改中段前它就是胶囊。
    expect(current().tokenRanges).toEqual([{start: 4, end: 14}]);
  });

  it('`$` 选择器确认：插入 $技能 token', async () => {
    const setComposerText = jest.fn();
    await mount({setComposerText});
    await act(async () => {
      current().onChangeText('');
      current().onSelectionChange({start: 0, end: 0});
    });

    await act(async () => {
      current().handleDockAction('skillPicker');
    });
    expect(current().skillPickerOpen).toBe(true);
    await act(async () => {
      current().onSkillPickerConfirm('写作');
    });

    expect(setComposerText).toHaveBeenCalledWith('$写作 ', 4);
    expect(readChatComposerDraftState('s1').text).toBe('$写作 ');
    // 插入咽喉点（CR-fix-04）：空草稿插入 $技能，登记区间 [0, 3)（含触发符，
    // '$写作' 共 3 字符）。
    expect(current().tokenRanges).toEqual([{start: 0, end: 3}]);
  });

  it('有未完成 @ 查询时从触发符起替换（不残留半截查询）', async () => {
    const setComposerText = jest.fn();
    await mount({setComposerText});
    await act(async () => {
      current().onChangeText('@docs/a');
      current().onSelectionChange({start: 8, end: 8});
    });

    await act(async () => {
      current().onAtPickerConfirm(['@docs/ab.md']);
    });

    expect(setComposerText).toHaveBeenCalledWith('@docs/ab.md ', 12);
  });

  it('空 token 列表：什么都不做（不写库、不下发）', async () => {
    const setComposerText = jest.fn();
    await mount({setComposerText});
    await act(async () => {
      current().onAtPickerConfirm([]);
    });

    expect(setComposerText).not.toHaveBeenCalled();
  });
});

describe('useChatComposerController · composerState 组装', () => {
  it('字段齐全 + hasModel 与 inputDisabled 各自独立', async () => {
    await mount({
      running: true,
      hasModel: false,
      onOpenComposerFullscreen: () => undefined,
    });

    const state = current().composerState;
    expect(state.hasModel).toBe(false);
    expect(state.inputDisabled).toBe(true);
    expect(state.running).toBe(true);
    expect(state.placeholder).toBe('选择模型后可发送');
    expect(state.fullscreenEnabled).toBe(true);
    expect(Array.isArray(state.chips)).toBe(true);
    expect(state.keyboardUp).toBe(false);
    // 无 error 时不下 error 键（web 侧按缺省渲染空行）。
    expect('error' in state).toBe(false);
  });

  it('safeAreaBottom 取 insets.bottom（键盘弹起时 dock 底 padding 归零由 web 侧做）', async () => {
    await mount();
    expect(current().safeAreaBottom).toBe(24);
  });
});

/**
 * 胶囊确认制 · tokenRanges 四咽喉点（CR-fix-04）。
 *
 * controller 的 tokenRanges state 有四处推进口，每处都是「注释掉就红」的
 * 变异点：onChangeText 打字差分重映射、Picker 落文登记（上方两条
 * 断言补过）、水化/切换会话引导扫描、发送/清空归空。这里补打字/水化/清空
 * 三条，插入登记两条已并入上方 Picker 用例。
 */
describe('useChatComposerController · tokenRanges 四咽喉点', () => {
  /** 预置带 token 的初始草稿（controller 初值对它做一次正则全扫引导）。 */
  function seedDraft(sessionId: string, text: string) {
    writeChatComposerDraft(sessionId, text, mockRuntime.sessions);
  }

  it('打字咽喉点：差分重映射（头部插入右移 / 中段改动摘除）', async () => {
    seedDraft('s1', '$时序图大纲');
    await mount();
    expect(current().tokenRanges).toEqual([{start: 0, end: 6}]);

    // 头部插入：区间整体右移保留
    await act(async () => {
      current().onChangeText('先看 $时序图大纲');
    });
    expect(current().tokenRanges).toEqual([{start: 3, end: 9}]);

    // 区间中段被改动（删除窗与胶囊重叠）：整条摘除
    await act(async () => {
      current().onChangeText('先看 $时序改稿');
    });
    expect(current().tokenRanges).toEqual([]);
  });

  it('水化/切换会话咽喉点：rerender 换 sessionId 后 tokenRanges 重扫', async () => {
    seedDraft('s1', '');
    const tree = await mount();
    expect(current().tokenRanges).toEqual([]);

    // s2 有带 token 的草稿：换 scope 触发水化 effect 的引导扫描
    seedDraft('s2', '换个会话 $技能');
    await act(async () => {
      tree.update(<Harness scope={{projectId: 'p2', sessionId: 's2'}} />);
    });
    await flush();

    expect(current().text).toBe('换个会话 $技能');
    expect(current().tokenRanges).toEqual([{start: 5, end: 8}]);
  });

  it('发送咽喉点：append 成功后 tokenRanges 归空', async () => {
    seedDraft('s1', '$时序图大纲');
    await mount({setComposerText: jest.fn()});
    expect(current().tokenRanges).toEqual([{start: 0, end: 6}]);

    // 真机 manager 在 append 成功后同步回调；mock 补上这条回调路径。
    mockStartRun.mockImplementation((...args: unknown[]) => {
      const opts = args[3] as
        | {
            onUserMessageAppended?: () => void;
            onSettled?: () => void;
          }
        | undefined;
      opts?.onUserMessageAppended?.();
      opts?.onSettled?.();
      return {ok: true};
    });

    await act(async () => {
      current().handleDockAction('send');
    });
    await flush();

    expect(current().text).toBe('');
    expect(current().tokenRanges).toEqual([]);
  });
});
