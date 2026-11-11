/**
 * 会话 WebView 判路纯测试（`chat-conversation-update-plan.ts`）。
 *
 * 为什么独立：planner 是快照 effect 的决策面，必须在**不挂 WebView**的情况下钉死
 * 分支优先级与遥测载荷（先例 `chat-transcript-snapshot-bytes.test.tsx` 的纯函数
 * describe）。本文件零 mock：planner 只依赖消息类型与两个纯谓词。
 *
 * chat-streaming-projection Step 4（C11）：committed 三态删除，新增
 * `stream-adopted`（DB 接管）；prepend 计数改为「旧首行在新列表中的下标」，
 * 前插 + 尾部任何新增 → 全量对账。
 */
import {describe, expect, it} from '@jest/globals';
import {type ChatMessageData} from '@novel-master/core/chat';
import {
  planMessagesUpdate,
  planOpenSnapshot,
} from '@/components/chat/chat-conversation-update-plan';

function message(
  id: string,
  seq: number,
  overrides: Partial<ChatMessageData> = {},
): ChatMessageData {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'user',
    content: {blocks: [{type: 'text', text: `msg-${id}`}]},
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
    ...overrides,
  };
}

function assistant(id: string, seq: number): ChatMessageData {
  return message(id, seq, {role: 'assistant'});
}

type OpenInput = Parameters<typeof planOpenSnapshot>[0];

function openInput(overrides: Partial<OpenInput> = {}): OpenInput {
  return {
    messageCount: 1,
    hasStreamingMessage: false,
    sessionKey: 'p1:s1',
    initialScroll: null,
    defaultScrollToBottom: false,
    ...overrides,
  };
}

function openPlan(overrides: Partial<OpenInput> = {}) {
  const plan = planOpenSnapshot(openInput(overrides));
  if (plan.kind !== 'open') {
    throw new Error(`expected open plan, got ${plan.kind}`);
  }
  return plan;
}

type UpdateInput = Parameters<typeof planMessagesUpdate>[0];

function updateInput(overrides: Partial<UpdateInput> = {}): UpdateInput {
  return {
    messages: [message('m1', 1)],
    previousMessages: [],
    prevFirstId: undefined,
    prevCount: 0,
    uiRunning: false,
    streamRowIds: new Map(),
    lastScroll: {nearBottom: false, offsetY: 0},
    ...overrides,
  };
}

describe('planOpenSnapshot（纯函数 · 开屏滚动意图与遥测）', () => {
  it('O1: 空列表 → wait-empty（不产出任何事件）', () => {
    expect(planOpenSnapshot(openInput({messageCount: 0}))).toEqual({
      kind: 'wait-empty',
    });
  });

  it('O2: defaultScrollToBottom 优先于 initialScroll → stick', () => {
    const plan = openPlan({
      defaultScrollToBottom: true,
      initialScroll: {offsetY: 120, nearBottom: false},
    });
    expect(plan.intent).toBe('stick');
    expect(plan.restoreScroll).toBeUndefined();
    expect(plan.events[0]).toEqual({name: 'scroll_restore', mode: 'stick'});
    // P2-19：hasInitialScroll=true 与 defaultScrollToBottom=true 此前从未断言。
    expect(plan.events[1]).toEqual({
      name: 'transcript_ready',
      sessionKey: 'p1:s1',
      rowCount: 1,
      hasInitialScroll: true,
      defaultScrollToBottom: true,
    });
  });

  it('O3: 无缓存快照（initialScroll null）→ stick，hasInitialScroll=false', () => {
    const plan = openPlan({initialScroll: null});
    expect(plan.intent).toBe('stick');
    expect(plan.restoreScroll).toBeUndefined();
    expect(plan.events[1]).toMatchObject({
      name: 'transcript_ready',
      hasInitialScroll: false,
    });
  });

  it('O4: 缓存快照贴底（nearBottom true）→ stick', () => {
    const plan = openPlan({initialScroll: {offsetY: 40, nearBottom: true}});
    expect(plan.intent).toBe('stick');
    expect(plan.restoreScroll).toBeUndefined();
  });

  it('O5: 缓存快照非贴底 → restore + restoreScroll 原样搬运', () => {
    const plan = openPlan({initialScroll: {offsetY: 120, nearBottom: false}});
    expect(plan.intent).toBe('restore');
    expect(plan.restoreScroll).toEqual({offsetY: 120, nearBottom: false});
    expect(plan.events[0]).toEqual({
      name: 'scroll_restore',
      mode: 'offset',
      offsetY: 120,
      nearBottom: false,
    });
    expect(plan.events[1]).toMatchObject({
      name: 'transcript_ready',
      hasInitialScroll: true,
      defaultScrollToBottom: false,
    });
  });

  it('O6: 事件顺序固定 scroll_restore → transcript_ready', () => {
    expect(openPlan().events.map(event => event.name)).toEqual([
      'scroll_restore',
      'transcript_ready',
    ]);
  });

  it('O7: transcript_ready.rowCount 取消息数（不是派生行数）', () => {
    const plan = openPlan({messageCount: 3, sessionKey: 'p1:s1'});
    expect(plan.events[1]).toEqual({
      name: 'transcript_ready',
      sessionKey: 'p1:s1',
      rowCount: 3,
      hasInitialScroll: false,
      defaultScrollToBottom: false,
    });
  });

  it('O8: 空会话但有流式行 → 仍发开屏快照，rowCount 计入流式行（C11）', () => {
    const plan = openPlan({messageCount: 0, hasStreamingMessage: true});
    expect(plan.events[1]).toMatchObject({
      name: 'transcript_ready',
      rowCount: 1,
    });
  });
});

describe('planMessagesUpdate（纯函数 · 分支优先级）', () => {
  it('M1: 同一引用 → same-reference', () => {
    const same = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: same,
        previousMessages: same,
        prevCount: 1,
        prevFirstId: 'm1',
      }),
    );
    expect(plan.kind).toBe('same-reference');
  });

  it('M2: 等长、首条 id 不变、hidden 翻转 → hidden-changed', () => {
    const prev = [message('m1', 1), message('m2', 2)];
    const next = [prev[0]!, {...prev[1]!, hidden: true}];
    const plan = planMessagesUpdate(
      updateInput({
        messages: next,
        previousMessages: prev,
        prevCount: 2,
        prevFirstId: 'm1',
      }),
    );
    expect(plan.kind).toBe('hidden-changed');
  });

  it('M3: 等长、hidden 不变 → snapshot preserve', () => {
    const prev = [message('m1', 1), message('m2', 2)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m1', 1), message('m2', 2)],
        previousMessages: prev,
        prevCount: 2,
        prevFirstId: 'm1',
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'preserve'});
  });

  it('M4: grew + 首条 id 变化（纯前插）→ prepend（遥测读 lastScroll 值）', () => {
    const prev = [message('m1', 1)];
    const next = [message('m0', 0), message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: next,
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        lastScroll: {nearBottom: false, offsetY: 77},
      }),
    );
    expect(plan).toEqual({
      kind: 'prepend',
      prependedCount: 1,
      event: {
        name: 'prepend_detected',
        prependedCount: 1,
        wasNearBottom: false,
        offsetYBefore: 77,
      },
    });
  });

  it('M4b: prepend 时 wasNearBottom 取真实值（true 不被写死）', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m0', 0), message('m1', 1)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        lastScroll: {nearBottom: true, offsetY: 0},
      }),
    );
    expect(plan).toEqual({
      kind: 'prepend',
      prependedCount: 1,
      event: {
        name: 'prepend_detected',
        prependedCount: 1,
        wasNearBottom: true,
        offsetYBefore: 0,
      },
    });
  });

  it('M5: grew 但 prevFirstId 未知 → 不是 prepend（落 snapshot preserve）', () => {
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m1', 1)],
        previousMessages: [],
        prevCount: 0,
        prevFirstId: undefined,
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'preserve'});
  });

  it('M6: grew + uiRunning + 普通文本 → append，added 为尾部切片', () => {
    const prev = [message('m1', 1)];
    const added = message('m2', 2);
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, added],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
      }),
    );
    expect(plan).toEqual({kind: 'append', added: [added]});
  });

  it('M6b: grew + uiRunning + 多行普通文本 → append 全量尾部切片', () => {
    const prev = [message('m1', 1)];
    const added = [message('m2', 2), message('m3', 3)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, ...added],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
      }),
    );
    expect(plan).toEqual({kind: 'append', added});
  });

  it('M6c: grew + uiRunning + assistant 纯文本新增 → append（不是 force-snapshot）', () => {
    const prev = [message('m1', 1)];
    const added = assistant('a1', 2);
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, added],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
      }),
    );
    expect(plan).toEqual({kind: 'append', added: [added]});
  });

  it('M7: grew + uiRunning + tool_results-only → force-snapshot', () => {
    const prev = [message('m1', 1)];
    const toolResult = message('tr1', 2, {
      content: {
        blocks: [{type: 'tool_result', toolUseId: 'c1', content: 'ok'}],
      },
    });
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, toolResult],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
      }),
    );
    expect(plan.kind).toBe('force-snapshot');
  });

  it('M7b: 混合新增（普通文本 + tool_results-only）→ force-snapshot（some 不是 every）', () => {
    const prev = [message('m1', 1)];
    const plain = message('u2', 2);
    const toolResult = message('tr1', 3, {
      content: {
        blocks: [{type: 'tool_result', toolUseId: 'c1', content: 'ok'}],
      },
    });
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, plain, toolResult],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
      }),
    );
    expect(plan.kind).toBe('force-snapshot');
  });

  it('M8: grew + uiRunning + assistant tool_use → force-snapshot', () => {
    const prev = [message('m1', 1)];
    const toolUse = message('a1', 2, {
      role: 'assistant',
      content: {
        blocks: [{type: 'tool_use', id: 'c1', name: 'read', input: {}}],
      },
    });
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, toolUse],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
      }),
    );
    expect(plan.kind).toBe('force-snapshot');
  });

  it('M8b: 混合新增（assistant tool_use + 普通文本）→ force-snapshot（some 不是 every）', () => {
    const prev = [message('m1', 1)];
    const toolUse = message('a1', 2, {
      role: 'assistant',
      content: {
        blocks: [{type: 'tool_use', id: 'c1', name: 'read', input: {}}],
      },
    });
    const plain = message('u2', 3);
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, toolUse, plain],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
      }),
    );
    expect(plan.kind).toBe('force-snapshot');
  });

  it('M9: grew + 非运行态 + 普通新增 → snapshot preserve', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m1', 1), message('m2', 2)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'preserve'});
  });

  it('M10: 变短 → snapshot stick', () => {
    const prev = [message('m1', 1), message('m2', 2), message('m3', 3)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m1', 1)],
        previousMessages: prev,
        prevCount: 3,
        prevFirstId: 'm1',
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'stick'});
  });

  it('M10b: 缩到 0 条 → snapshot stick', () => {
    const prev = [message('m1', 1), message('m2', 2), message('m3', 3)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [],
        previousMessages: prev,
        prevCount: 3,
        prevFirstId: 'm1',
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'stick'});
  });

  it('M11: 等长 + 首条 id 变化 → snapshot stick', () => {
    const prev = [message('m1', 1), message('m2', 2)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m0', 0), message('m2', 2)],
        previousMessages: prev,
        prevCount: 2,
        prevFirstId: 'm1',
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'stick'});
  });

  it('M11b: 等长 + 首条 id 变化 + hidden 也变 → snapshot stick（不是 hidden-changed）', () => {
    const prev = [message('m1', 1), message('m2', 2)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [{...message('m0', 0), hidden: true}, prev[1]!],
        previousMessages: prev,
        prevCount: 2,
        prevFirstId: 'm1',
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'stick'});
  });

  it('M12: 等长 + 首条 id 不变 + 正文变 → snapshot preserve', () => {
    const prev = [message('m1', 1), message('m2', 2)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [
          message('m1', 1, {
            content: {blocks: [{type: 'text', text: 'edited'}]},
          }),
          message('m2', 2),
        ],
        previousMessages: prev,
        prevCount: 2,
        prevFirstId: 'm1',
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'preserve'});
  });

  it('M13: 纯 loadOlder（两行前插、无尾部新增）→ prepend，prependedCount 取旧首行下标', () => {
    const prev = [message('m2', 2), message('m3', 3)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [
          message('m0', 0),
          message('m1', 1),
          message('m2', 2),
          message('m3', 3),
        ],
        previousMessages: prev,
        prevCount: 2,
        prevFirstId: 'm2',
      }),
    );
    expect(plan.kind).toBe('prepend');
    if (plan.kind === 'prepend') {
      expect(plan.prependedCount).toBe(2);
    }
  });

  it('M14: 前插 + 尾部 adopted 同拍 → force-snapshot（prepend 页发不了尾部）', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m0', 0), message('m1', 1), assistant('a1', 3)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        streamRowIds: new Map([['a1', 'st-1']]),
      }),
    );
    expect(plan.kind).toBe('force-snapshot');
  });

  it('M15: 前插 + 尾部普通新增同拍 → force-snapshot', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m0', 0), message('m1', 1), message('m2', 2)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
      }),
    );
    expect(plan.kind).toBe('force-snapshot');
  });

  it('M16: 旧首行不在新列表 → force-snapshot（头尾都可能变，无法安全前插）', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m0', 0), assistant('a1', 2)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
      }),
    );
    expect(plan.kind).toBe('force-snapshot');
  });

  it('M17: 新增 assistant 全部命中 streamRowIds → stream-adopted（逐条带 DB id）', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, assistant('a1', 2), assistant('a2', 3)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        streamRowIds: new Map([
          ['a1', 'st-1'],
          ['a2', 'st-2'],
        ]),
      }),
    );
    expect(plan).toEqual({
      kind: 'stream-adopted',
      adopted: [
        {messageId: 'a1', streamId: 'st-1'},
        {messageId: 'a2', streamId: 'st-2'},
      ],
    });
  });

  it('M18: 新增里混合 adopted 与普通行 → force-snapshot（append 会重复 id）', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, assistant('a1', 2), message('u2', 3)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        streamRowIds: new Map([['a1', 'st-1']]),
      }),
    );
    expect(plan.kind).toBe('force-snapshot');
  });

  it('M19: 空 streamRowIds + uiRunning 普通新增 → append（T-SP33 回滚等价面）', () => {
    const prev = [message('m1', 1)];
    const added = message('m2', 2);
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, added],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
        streamRowIds: new Map(),
      }),
    );
    expect(plan).toEqual({kind: 'append', added: [added]});
  });

  it('M20: 空 streamRowIds + 空闲态新增 assistant → snapshot（不会 stream-adopted）', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, assistant('a1', 2)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        streamRowIds: new Map(),
      }),
    );
    expect(plan).toEqual({kind: 'snapshot', intent: 'preserve'});
  });

  it('M21: adopted 判定优先于 uiRunning 的 append 分支', () => {
    const prev = [message('m1', 1)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [prev[0]!, assistant('a1', 2)],
        previousMessages: prev,
        prevCount: 1,
        prevFirstId: 'm1',
        uiRunning: true,
        streamRowIds: new Map([['a1', 'st-1']]),
      }),
    );
    expect(plan.kind).toBe('stream-adopted');
  });

  it('M22: 等长 hidden 翻转 + 非空 streamRowIds → hidden-changed', () => {
    const prev = [message('m1', 1), message('m2', 2)];
    const plan = planMessagesUpdate(
      updateInput({
        messages: [message('m1', 1), {...message('m2', 2), hidden: true}],
        previousMessages: prev,
        prevCount: 2,
        prevFirstId: 'm1',
        streamRowIds: new Map([['m2', 'st-2']]),
      }),
    );
    expect(plan.kind).toBe('hidden-changed');
  });
});
