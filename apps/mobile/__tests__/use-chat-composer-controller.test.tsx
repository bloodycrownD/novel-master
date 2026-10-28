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

// token-ranges 探针：D1 水化优先的验收点是「持久化 ranges 生效时**不**扫描」，
// 行为断言之外再用调用探针钉一次（spec T-CA2）。
// 只包一层计数，实现仍是 actual——remap/synthesize 行为零差分。
jest.mock('../src/components/chat/native-composer/token-ranges', () => {
  const actual = jest.requireActual<
    typeof import('../src/components/chat/native-composer/token-ranges')
  >('../src/components/chat/native-composer/token-ranges');
  return {
    ...actual,
    scanTokensToRanges: jest.fn(actual.scanTokensToRanges),
  };
});

const mockStartRun = jest.fn(
  (..._args: unknown[]) => ({ok: true}) as {ok: boolean; error?: string},
);
const mockStopRun = jest.fn();

const mockRuntime: Record<string, any> = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
jest.mock('../src/hooks/useRuntime', () => ({
  useRuntime: () => mockRuntime,
}));

import { useChatComposerController } from '../src/components/chat/useChatComposerController';

type ChatComposerController = ReturnType<typeof useChatComposerController>;
type UseChatComposerControllerOptions = Parameters<typeof useChatComposerController>[0];
import {
  applyComposerStatusAttachmentsReplace,
  clearChatComposerDraft,
  readChatComposerDraftState,
  writeChatComposerDraft,
  writeChatComposerDraftState,
} from '../src/storage/chat-composer-draft';
import {
  scanTokensToRanges,
} from '../src/components/chat/native-composer/token-ranges';
import { chatAnnotateDraftStore } from '@novel-master/core/chat';

/** 探针（模块被 jest.mock 包了一层计数，实现仍是 actual）。 */
const mockScanTokensToRanges = jest.mocked(scanTokensToRanges);

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
  chatAnnotateDraftStore.resetForTests();
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

  it('T-CA9 ①: 贴邻两颗技能 $A$$B$ → 区间扫描两颗都进 attachments，掩码区间同步透传', async () => {
    writeChatComposerDraftState(
      's1',
      {
        text: '$agent-config$$节拍成章$',
        attachments: [],
        tokenRanges: [
          {start: 0, end: 14},
          {start: 14, end: 20},
        ],
      },
      mockRuntime.sessions,
    );
    await mount();
    expect(current().tokenRanges).toEqual([
      {start: 0, end: 14},
      {start: 14, end: 20},
    ]);

    await act(async () => {
      current().handleDockAction('send');
    });
    await flush();

    expect(mockStartRun).toHaveBeenCalledTimes(1);
    const args = mockStartRun.mock.calls[0]!;
    expect(args[2]).toBe('$agent-config$$节拍成章$');
    const options = args[3] as {
      attachments?: readonly {action?: string; skillName?: string}[];
      excludedScanRanges?: unknown;
    };
    // 掩码后全量扫描看不到区间内的触发符，两颗都来自区间扫描。
    expect(
      (options.attachments ?? [])
        .filter(item => item.action === 'skillAttach')
        .map(item => item.skillName)
        .sort(),
    ).toEqual(['agent-config', '节拍成章']);
    expect(options.excludedScanRanges).toEqual([
      {start: 0, end: 14},
      {start: 14, end: 20},
    ]);
  });

  it('T-CA9 ②: @docs/a.md@$写作$ → 路径无污染 + 技能各挂各的', async () => {
    writeChatComposerDraftState(
      's1',
      {
        text: '@docs/a.md@$写作$',
        attachments: [],
        tokenRanges: [
          {start: 0, end: 11},
          {start: 11, end: 15},
        ],
      },
      mockRuntime.sessions,
    );
    await mount();

    await act(async () => {
      current().handleDockAction('send');
    });
    await flush();

    const args = mockStartRun.mock.calls[0]!;
    expect(args[2]).toBe('@docs/a.md@$写作$');
    const options = args[3] as {
      attachments?: readonly {action?: string; path?: string; skillName?: string}[];
      excludedScanRanges?: unknown;
    };
    const attachments = options.attachments ?? [];
    // 区间按 token 边界切开：路径止于自己的终止符，不吞技能 token。
    expect(
      attachments.filter(item => item.path != null).map(item => item.path),
    ).toEqual(['/docs/a.md']);
    expect(
      attachments
        .filter(item => item.action === 'skillAttach')
        .map(item => item.skillName),
    ).toEqual(['写作']);
    expect(options.excludedScanRanges).toEqual([
      {start: 0, end: 11},
      {start: 11, end: 15},
    ]);
  });

  it('T-CA9 ③: 无区间草稿 → 全量扫描直出 attachments（单条链路，不经掩码路径）', async () => {
    await mount();
    await act(async () => {
      current().onChangeText('手输 $A 与 @docs/b.md');
    });
    await act(async () => {
      current().handleDockAction('send');
    });
    await flush();

    expect(current().tokenRanges).toEqual([]);
    const args = mockStartRun.mock.calls[0]!;
    expect(args[2]).toBe('手输 $A 与 @docs/b.md');
    const options = args[3] as {
      attachments?: readonly {
        action?: string;
        path?: string;
        skillName?: string;
      }[];
      excludedScanRanges?: unknown;
    };
    // 无区间 = 历史全量扫描（scanAtPath → scanSkill 顺序，与 core 同序）；
    // 不经掩码路径，也不下传 excludedScanRanges。
    expect(options.excludedScanRanges).toBeUndefined();
    expect(
      (options.attachments ?? []).map(item => item.skillName ?? item.path),
    ).toEqual(['/docs/b.md', 'A']);
  });

  it('T-CA9 ③b: 区间外手输 token 仍经掩码全量扫描挂载（二段式的第 2 段）', async () => {
    writeChatComposerDraftState(
      's1',
      {
        text: '$A$$B$ 手输 $C 与 @notes/a.md',
        attachments: [],
        tokenRanges: [
          {start: 0, end: 3},
          {start: 3, end: 6},
        ],
      },
      mockRuntime.sessions,
    );
    await mount();

    await act(async () => {
      current().handleDockAction('send');
    });
    await flush();

    const args = mockStartRun.mock.calls[0]!;
    const options = args[3] as {
      attachments?: readonly {
        action?: string;
        path?: string;
        skillName?: string;
      }[];
      excludedScanRanges?: unknown;
    };
    const attachments = options.attachments ?? [];
    // 区间段给 A/B，掩码后的全量扫描给区间外手输的 C 与路径——两段合并。
    expect(
      attachments
        .filter(item => item.action === 'skillAttach')
        .map(item => item.skillName)
        .sort(),
    ).toEqual(['A', 'B', 'C']);
    expect(
      attachments.filter(item => item.path != null).map(item => item.path),
    ).toEqual(['/notes/a.md']);
    // 保序断言（merge 方向判别力）：区间结果（A/B）必须占据 existing 位排在前面——
    // 若 mergeAttachmentsByPath 两参对调，顺序会变成 ['/notes/a.md','C','A','B']，本断言红。
    expect(attachments.map(item => item.skillName ?? item.path)).toEqual([
      'A',
      'B',
      '/notes/a.md',
      'C',
    ]);
    expect(options.excludedScanRanges).toEqual([
      {start: 0, end: 3},
      {start: 3, end: 6},
    ]);
  });

  it('T-CA9 ④: 草稿首带空白 + 区间 → trimStart 换算不错位', async () => {
    // 草稿两端带空白：tokenRanges 相对原文，发送正文是 text.trim()。
    writeChatComposerDraftState(
      's1',
      {
        text: '  $agent-config$$节拍成章$ ',
        attachments: [],
        tokenRanges: [
          {start: 2, end: 16},
          {start: 16, end: 22},
        ],
      },
      mockRuntime.sessions,
    );
    await mount();
    expect(current().text).toBe('  $agent-config$$节拍成章$ ');
    expect(current().tokenRanges).toEqual([
      {start: 2, end: 16},
      {start: 16, end: 22},
    ]);

    await act(async () => {
      current().handleDockAction('send');
    });
    await flush();

    expect(mockStartRun).toHaveBeenCalledTimes(1);
    const args = mockStartRun.mock.calls[0]!;
    expect(args[2]).toBe('$agent-config$$节拍成章$');
    const options = args[3] as {
      attachments?: readonly {action?: string; skillName?: string}[];
      excludedScanRanges?: unknown;
    };
    expect(
      (options.attachments ?? [])
        .filter(item => item.action === 'skillAttach')
        .map(item => item.skillName)
        .sort(),
    ).toEqual(['agent-config', '节拍成章']);
    // 前导 2 个空格被 trim：区间整体左移 2，尾部裁到正文长度。
    expect(options.excludedScanRanges).toEqual([
      {start: 0, end: 14},
      {start: 14, end: 20},
    ]);
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
    expect(text).toBe('看这里@docs/a.md@');
    expect(cursor).toBe((text as string).length);
    expect(readChatComposerDraftState('s1').text).toBe('看这里@docs/a.md@');
    expect(current().pickerOpen).toBe(true); // 关闭由宿主 Modal 自己驱动
    // 插入咽喉点（CR-fix-04）：落文同时登记插入 token 的确认区间——
    // '@docs/a.md@' 落在 [3, 14)（'看这里' 之后，含终止符），打字改中段前它就是胶囊。
    expect(current().tokenRanges).toEqual([{start: 3, end: 14}]);
  });

  it('`$` 选择器确认：插入 $技能$ token', async () => {
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

    expect(setComposerText).toHaveBeenCalledWith('$写作$', 4);
    expect(readChatComposerDraftState('s1').text).toBe('$写作$');
    // 插入咽喉点（CR-fix-04）：空草稿插入 $技能$，登记区间 [0, 4)（含两端
    // 触发符，'$写作$' 共 4 字符）。
    expect(current().tokenRanges).toEqual([{start: 0, end: 4}]);
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

    expect(setComposerText).toHaveBeenCalledWith('@docs/ab.md@', 12);
  });

  it('空 token 列表：什么都不做（不写库、不下发）', async () => {
    const setComposerText = jest.fn();
    await mount({setComposerText});
    await act(async () => {
      current().onAtPickerConfirm([]);
    });

    expect(setComposerText).not.toHaveBeenCalled();
  });

  it('连插两颗 $ 技能：光标贴第一颗胶囊尾部时第二颗纯插入，不替换（2026-10-20 真机轮）', async () => {
    const setComposerText = jest.fn();
    await mount({setComposerText});
    await act(async () => {
      current().handleDockAction('skillPicker');
    });
    await act(async () => {
      current().onSkillPickerConfirm('agent-config');
    });
    // chip 模型：插入即贴尾（无尾随空格），光标 14 正贴第一颗胶囊末端
    // ——正是旧逻辑把整颗胶囊误当活动查询替换掉的现场。
    await act(async () => {
      current().onSelectionChange({start: 14, end: 14});
    });

    await act(async () => {
      current().onSkillPickerConfirm('节拍成章');
    });

    expect(setComposerText).toHaveBeenLastCalledWith(
      '$agent-config$$节拍成章$',
      20,
    );
    expect(current().tokenRanges).toEqual([
      {start: 0, end: 14},
      {start: 14, end: 20},
    ]);
  });

  it('连插两颗 @ 引用：确认胶囊不被当查询替换（@ 侧同守卫）', async () => {
    const setComposerText = jest.fn();
    await mount({setComposerText});
    await act(async () => {
      current().handleDockAction('atPicker');
    });
    await act(async () => {
      current().onAtPickerConfirm(['@docs/a.md']);
    });
    await act(async () => {
      current().onSelectionChange({start: 11, end: 11});
    });

    await act(async () => {
      current().onAtPickerConfirm(['@docs/b.md']);
    });

    expect(setComposerText).toHaveBeenLastCalledWith(
      '@docs/a.md@@docs/b.md@',
      22,
    );
    expect(current().tokenRanges).toEqual([
      {start: 0, end: 11},
      {start: 11, end: 22},
    ]);
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
    seedDraft('s1', '$时序图大纲$');
    await mount();
    expect(current().tokenRanges).toEqual([{start: 0, end: 7}]);

    // 头部插入：区间整体右移保留
    await act(async () => {
      current().onChangeText('先看 $时序图大纲$');
    });
    expect(current().tokenRanges).toEqual([{start: 3, end: 10}]);

    // 区间中段被改动（删除窗与胶囊重叠）：整条摘除
    await act(async () => {
      current().onChangeText('先看 $时序改稿$');
    });
    expect(current().tokenRanges).toEqual([]);
  });

  it('T-CA10: 相邻胶囊 $A$$B$ 删左颗 → 幸存区间保留且落库 payload 同值（D11 controller 跳）', async () => {
    writeChatComposerDraftState(
      's1',
      {
        text: '$A$$B$',
        attachments: [],
        tokenRanges: [
          {start: 0, end: 3},
          {start: 3, end: 6},
        ],
      },
      mockRuntime.sessions,
    );
    await mount();
    expect(current().tokenRanges).toEqual([
      {start: 0, end: 3},
      {start: 3, end: 6},
    ]);

    // 编辑前光标由上一次选区事件落位（贴在 A 右缘）；随后文本变更事件到达
    // （原生先发文本变更、后发选区回调，此刻 ref 里仍是编辑前的值）。
    await act(async () => {
      current().onSelectionChange({start: 3, end: 3});
    });
    await act(async () => {
      current().onChangeText('$B$');
    });

    // 没有 prevCursor 时差分对齐会把删除点咬进 B 内部、两颗一起摘除；
    // controller 补传之后 A 被摘、B 平移幸存为 [0,3)。
    expect(current().tokenRanges).toEqual([{start: 0, end: 3}]);
    const payload = JSON.parse(mockDraftDb.get('s1')!) as {
      tokenRanges?: unknown;
    };
    expect(payload.tokenRanges).toEqual([{start: 0, end: 3}]);
  });

  it('T-CA10 水化对称：syncFromDraft 把编辑前光标落到文本尾，相邻删除不被旧选区污染', async () => {
    // s1 上先留下一个「上一个会话」的选区：不同步推进的话，它会在切会话后
    // 继续充当删除锚（P3-2 的污染源）。
    const tree = await mount();
    await act(async () => {
      current().onSelectionChange({start: 5, end: 5});
    });

    // 切到 s2：水化带区间草稿 `$A$$A$`。组件侧水化会把选区落到文本尾（6），
    // controller 的编辑前光标必须同拍对齐。
    mockDraftDb.set(
      's2',
      JSON.stringify({
        text: '$A$$A$',
        attachments: [],
        tokenRanges: [
          {start: 0, end: 3},
          {start: 3, end: 6},
        ],
      }),
    );
    await act(async () => {
      tree.update(<Harness scope={{projectId: 'p1', sessionId: 's2'}} />);
    });
    await flush();
    expect(current().text).toBe('$A$$A$');
    expect(current().tokenRanges).toEqual([
      {start: 0, end: 3},
      {start: 3, end: 6},
    ]);

    // 水化后直接一次原子退格（原生顺序：文本变更先到、选区回调后到，此刻
    // 编辑前光标只能来自水化对齐值）。残留旧值 5 会反推出守卫可通过的删除段
    // [2,5)，把左颗一并摘掉；对齐到 6 后删除段是 [3,6)，左颗幸存。
    await act(async () => {
      current().onChangeText('$A$');
    });

    expect(current().tokenRanges).toEqual([{start: 0, end: 3}]);
    const payload = JSON.parse(mockDraftDb.get('s2')!) as {
      text?: string;
      tokenRanges?: unknown;
    };
    expect(payload.text).toBe('$A$');
    expect(payload.tokenRanges).toEqual([{start: 0, end: 3}]);
  });

  it('水化/切换会话咽喉点：rerender 换 sessionId 后 tokenRanges 重扫', async () => {
    seedDraft('s1', '');
    const tree = await mount();
    expect(current().tokenRanges).toEqual([]);

    // s2 有带 token 的草稿：换 scope 触发水化 effect 的引导扫描
    seedDraft('s2', '换个会话 $技能$');
    await act(async () => {
      tree.update(<Harness scope={{projectId: 'p2', sessionId: 's2'}} />);
    });
    await flush();

    expect(current().text).toBe('换个会话 $技能$');
    expect(current().tokenRanges).toEqual([{start: 5, end: 9}]);
  });

  it('发送咽喉点：append 成功后 tokenRanges 归空', async () => {
    seedDraft('s1', '$时序图大纲$');
    await mount({setComposerText: jest.fn()});
    expect(current().tokenRanges).toEqual([{start: 0, end: 7}]);

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

/**
 * D1 草稿 tokenRanges 持久化优先（T-CA2/T-CA3/T-CA4/T-CA8 · mobile controller）。
 *
 * 验收路径必须走**真实水化链**（hydrateChatComposerDraftFromDb →
 * projectComposerStatusForSession → applyComposerStatusAttachmentsReplace →
 * syncFromDraft）：statusBar 投影重建缓存条目时丢字段的缺陷（R2 P0-2）只有
 * 走整链才抓得到，controller spy 之间的一致性不算数。
 */
describe('useChatComposerController · D1 tokenRanges 持久化优先', () => {
  /** 直接预置 DB 行（绕开 store，模拟旧版本落下的 JSON）。 */
  function seedDbJson(sessionId: string, payload: unknown): void {
    mockDraftDb.set(sessionId, JSON.stringify(payload));
  }

  function readDbPayload(sessionId: string): Record<string, unknown> {
    const raw = mockDraftDb.get(sessionId);
    if (raw == null) {
      throw new Error(`session ${sessionId} 没有草稿 JSON`);
    }
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it('T-CA3: 持久化旧区间被水化自愈丢弃并写回 []（不回退扫描）', async () => {
    // 缓存与 DB 双侧都带**旧格式**区间（`$技能` 无尾终止符，已被新正则判废）：
    // 初始 state 与 syncFromDraft 都要丢弃，且丢弃不是回退扫描。
    writeChatComposerDraftState(
      's1',
      {
        text: '$技能尾追',
        attachments: [],
        tokenRanges: [{start: 0, end: 3}],
      },
      mockRuntime.sessions,
    );
    mockScanTokensToRanges.mockClear();

    await mount();

    // 旧区间丢弃后文本原样保留，胶囊为空；探针钉住「丢弃走校验、不走扫描」。
    expect(current().text).toBe('$技能尾追');
    expect(current().tokenRanges).toEqual([]);
    expect(mockScanTokensToRanges).not.toHaveBeenCalled();
    // 自愈要写回草稿：DB 里的旧区间必须被 `[]` 覆盖，否则下次水化还会循环。
    expect(readDbPayload('s1').tokenRanges).toEqual([]);
  });

  it('T-CA8: 水化真实链（DB → hydrate → project → apply → sync）带 ranges 生效且不回写扫描值', async () => {
    // 只预置 DB：首帧缓存为空，水化链才是 ranges 的唯一来源。
    seedDbJson('s1', {
      text: '$技能$尾追',
      attachments: [],
      tokenRanges: [{start: 0, end: 4}],
    });

    await mount();
    await flush();

    expect(current().text).toBe('$技能$尾追');
    expect(current().tokenRanges).toEqual([{start: 0, end: 4}]);
    // 带值分支不做兜底写回，DB 保持原值（没有被投影链抹成 undefined/[]）。
    expect(readDbPayload('s1').tokenRanges).toEqual([{start: 0, end: 4}]);
  });

  it('T-CA8/P0-2: 水化 {手输$foo$, tokenRanges: []} 经投影链后仍为 []，不触发扫描升格', async () => {
    seedDbJson('s1', {
      text: '手输$foo$',
      attachments: [],
      tokenRanges: [],
    });

    await mount();
    await flush();

    // `[]` = 确认无胶囊：全扫会得到 [{2,6}]，这里必须保持空。
    expect(current().tokenRanges).toEqual([]);
    expect(readDbPayload('s1').tokenRanges).toEqual([]);
    expect(current().text).toBe('手输$foo$');
  });

  it('T-CA3: 旧草稿 tokenRanges undefined → 兜底扫描一次并写回固化', async () => {
    // 旧格式明文（无尾终止符）在新正则下不再被识别成 token：兜底扫描结果为空，
    // 空结果同样写回固化（`tokenRanges: []` = 确认无胶囊）。
    seedDbJson('s1', {text: '$技能尾追', attachments: []});

    await mount();
    await flush();

    expect(current().tokenRanges).toEqual([]);
    // 写回固化：下一次水化就有值（`[]`），不再进入扫描分支。
    expect(readDbPayload('s1').tokenRanges).toEqual([]);
  });

  /**
   * F-A3 用户报告链路的**正例**：回滚重发把正文原样塞回草稿（不带 tokenRanges），
   * 水化兜底扫描必须只认成对终止符包住的那一颗——`$写文档$`，且 `总结` 留在胶囊外。
   * 负例（`$技能尾追` → `[]`）挡不住「正则永不命中」的实现，正例才是那条防线。
   */
  it('T-CA3: 回滚链正例 `帮我$写文档$总结` → 兜底扫描只认一颗胶囊并写回', async () => {
    seedDbJson('s1', {text: '帮我$写文档$总结', attachments: []});

    await mount();
    await flush();

    expect(current().tokenRanges).toEqual([{start: 2, end: 7}]);
    expect(readDbPayload('s1').tokenRanges).toEqual([{start: 2, end: 7}]);
  });

  it('T-CA3: 空草稿水化跳过写回（不产生空会话 null 写放大）', async () => {
    await mount();
    await flush();

    expect(mockRuntime.sessions.setComposerDraftJson).not.toHaveBeenCalled();
  });

  it('T-CA3: 同文本不同 ranges 切会话 → 各自归位（不按 textChanged 短路）', async () => {
    writeChatComposerDraftState(
      's1',
      {
        text: '$技能$尾追',
        attachments: [],
        tokenRanges: [{start: 0, end: 4}],
      },
      mockRuntime.sessions,
    );
    writeChatComposerDraftState(
      's2',
      {text: '$技能$尾追', attachments: [], tokenRanges: []},
      mockRuntime.sessions,
    );

    const tree = await mount();
    expect(current().tokenRanges).toEqual([{start: 0, end: 4}]);

    // 文本完全相同（textChanged=false），只有 ranges 不同：必须按内容比较更新。
    await act(async () => {
      tree.update(<Harness scope={{projectId: 'p1', sessionId: 's2'}} />);
    });
    await flush();

    expect(current().text).toBe('$技能$尾追');
    expect(current().tokenRanges).toEqual([]);
  });

  it('T-CA4: 尾追打字 remap 保持区间不增长，落库 payload 带当前 ranges', async () => {
    writeChatComposerDraftState(
      's1',
      {text: '$技能$', attachments: [], tokenRanges: [{start: 0, end: 4}]},
      mockRuntime.sessions,
    );
    await mount();

    await act(async () => {
      current().onChangeText('$技能$z');
    });

    // 贴右缘尾追不并入胶囊（区间不增长），且落库带同一份区间。
    expect(current().tokenRanges).toEqual([{start: 0, end: 4}]);
    const payload = readDbPayload('s1');
    expect(payload.text).toBe('$技能$z');
    expect(payload.tokenRanges).toEqual([{start: 0, end: 4}]);
  });

  it('T-CA4: 删除与胶囊相交 → 区间摘除并落库 []（不是缺字段）', async () => {
    writeChatComposerDraftState(
      's1',
      {
        text: '$技能$尾追',
        attachments: [],
        tokenRanges: [{start: 0, end: 4}],
      },
      mockRuntime.sessions,
    );
    await mount();

    // 删掉胶囊中段的「能」：区间与编辑区相交 → 整条摘除。
    await act(async () => {
      current().onChangeText('$技$尾追');
    });

    expect(current().tokenRanges).toEqual([]);
    const payload = readDbPayload('s1');
    expect(payload.text).toBe('$技$尾追');
    expect(payload.tokenRanges).toEqual([]);
    expect(
      Object.prototype.hasOwnProperty.call(payload, 'tokenRanges'),
    ).toBe(true);
  });

  it('T-CA4: Picker 插入落库 payload 带登记区间', async () => {
    await mount({setComposerText: jest.fn()});
    await act(async () => {
      current().onChangeText('看这里');
      current().onSelectionChange({start: 3, end: 3});
    });
    await act(async () => {
      current().onSkillPickerConfirm('写作');
    });

    // '看这里$写作$'（chip 模型：无补空格）：'$写作$' 落在 [3, 7)。
    expect(current().tokenRanges).toEqual([{start: 3, end: 7}]);
    const payload = readDbPayload('s1');
    expect(payload.text).toBe('看这里$写作$');
    expect(payload.tokenRanges).toEqual([{start: 3, end: 7}]);
  });

  it('T-CA4: 发送清空 → DB 置 NULL（下次水化 undefined + 空文本，扫描必空）', async () => {
    writeChatComposerDraftState(
      's1',
      {text: '$技能$', attachments: [], tokenRanges: [{start: 0, end: 4}]},
      mockRuntime.sessions,
    );
    await mount({setComposerText: jest.fn()});
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

    expect(mockDraftDb.get('s1')).toBeNull();
    expect(current().text).toBe('');
    expect(current().tokenRanges).toEqual([]);
  });
});
