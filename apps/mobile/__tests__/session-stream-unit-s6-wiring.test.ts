/**
 * Step 6 屏幕接线的单元级补充测试（T-U9 双屏句柄分发 + 停止入口）：
 * - 同一会话两个 webview 句柄（主会话屏 + 同会话的第二个可见屏实例）：
 *   流式推送只达「最后 attach 的可见句柄」，控制类消息全句柄广播双达；
 * - 主会话（startRun 发起）+ 子会话（RUN_STARTED lazy 消费型单元）并行：
 *   事件按 sessionId 路由互不串扰，各屏句柄收各自的流式载荷；
 * - 多会话并行时逐个停止互不影响、全部停止后无残留（manager 无 active
 *   单元、agentActive refcount 归零）；stopRun 经 abortRegistry.abort 生效。
 */
import {beforeEach, afterEach, describe, expect, it, jest} from '@jest/globals';
import {SimpleEventBus} from '@novel-master/core/events';
import {
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_SUBAGENT_CHILD_SESSION_CREATED,
} from '@novel-master/core/events';
import {
  isMobileAgentActive,
  setMobileAgentActive,
} from '@/runtime/agent-activity';
import {SessionStreamUnitManager} from '@/services/session-stream-unit-manager.service';
import type {SessionStreamWebviewHandle} from '@/services/session-stream-unit';

const mockRunAgentTurn = jest.fn(
  () => new Promise(() => undefined) as Promise<unknown>,
);

function buildHarness(options?: {
  abortHas?: (sessionId: string) => boolean;
}): {
  manager: SessionStreamUnitManager;
  eventBus: SimpleEventBus;
  abortRegistry: {
    has: jest.Mock;
    abort: jest.Mock;
  };
} {
  const eventBus = new SimpleEventBus();
  const abortRegistry = {
    has: jest.fn(options?.abortHas ?? (() => false)),
    abort: jest.fn(),
  };  const manager = new SessionStreamUnitManager({
    runtime: {
      eventBus,
      abortRegistry,
      sessions: {get: async () => ({id: 's', title: '会话'})},
      projects: {get: async () => ({id: 'p', name: '项目'})},
      messages: {
        listBySessionTail: jest.fn(async () => []),
        listBySessionPage: jest.fn(async () => []),
      },
    } as never,
    runAgentTurn: mockRunAgentTurn as never,
  });
  manager.markHydrated();
  return {manager, eventBus, abortRegistry};
}

/** 记录流式/控制消息的探针句柄。 */
function probeHandle(
  handleId: string,
  options?: {visible?: boolean},
): SessionStreamWebviewHandle & {
  streamPayloads: unknown[];
  controlMessages: unknown[];
} {
  const streamPayloads: unknown[] = [];
  const controlMessages: unknown[] = [];
  return {
    handleId,
    isVisible: () => options?.visible ?? true,
    onStreamPayload: payload => {
      streamPayloads.push(payload);
    },
    onControlMessage: message => {
      controlMessages.push(message);
    },
    streamPayloads,
    controlMessages,
  };
}

describe('T-U9: 双屏 webview 句柄分发 + 停止入口（Step 6）', () => {
  let h: ReturnType<typeof buildHarness>;

  beforeEach(() => {
    jest.useFakeTimers();
    setMobileAgentActive(false);
    mockRunAgentTurn.mockClear();
    h = buildHarness();
  });

  afterEach(() => {
    h.manager.dispose();
    jest.useRealTimers();
    setMobileAgentActive(false);
  });

  function startMainRun(): void {
    h.manager.startRun('s1', 'p1', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });
  }

  it('同会话两句柄：流式只达最后 attach 的可见句柄，控制消息全句柄广播', async () => {
    startMainRun();
    const first = probeHandle('screen-a');
    const second = probeHandle('screen-b');
    h.manager.attachWebview('s1', first);
    h.manager.attachWebview('s1', second);

    h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      runId: 'r1',
      text: '正文',
    });
    // 冲刷 ingress(32ms) + apply(64ms)：合并段以 stream-batch 推给流式目标句柄。
    jest.advanceTimersByTime(96);

    expect(first.streamPayloads).toHaveLength(0);
    expect(second.streamPayloads).toHaveLength(1);
    expect(second.streamPayloads[0]).toMatchObject({type: 'stream-batch'});

    // 控制消息（force-snapshot / reset-stream）对全句柄广播双达。
    h.manager.requestForceSnapshot('s1');
    h.manager.requestStreamReset('s1');
    expect(first.controlMessages).toEqual([
      {type: 'force-snapshot'},
      {type: 'reset-stream'},
    ]);
    expect(second.controlMessages).toEqual([
      {type: 'force-snapshot'},
      {type: 'reset-stream'},
    ]);

    // 摘除最后 attach 的句柄后，流式回落到前一可见句柄。
    h.manager.detachWebview('s1', 'screen-b');
    h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      runId: 'r1',
      text: '续写',
    });
    jest.advanceTimersByTime(96);
    expect(first.streamPayloads).toHaveLength(1);
    expect(second.streamPayloads).toHaveLength(1);
  });

  it('主会话 + 子会话（消费型单元）双屏并行：流式各达各屏、pending 链接跨屏可见', async () => {
    startMainRun();

    // 子会话 run（subagent child）以 child sessionId 发 RUN_STARTED：
    // manager lazy 建消费型单元——子会话屏订阅有投影。
    h.eventBus.publish(EVENT_SUBAGENT_CHILD_SESSION_CREATED, {
      parentSessionId: 's1',
      childSessionId: 's2',
      title: '任务一',
    });
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's2',
      projectId: 'p1',
      runId: 'child-run-1',
    });

    const mainScreen = probeHandle('main-screen');
    const subScreen = probeHandle('sub-screen');
    h.manager.attachWebview('s1', mainScreen);
    h.manager.attachWebview('s2', subScreen);

    // 父会话 pendingChildren 登记进投影（title 映射供任务卡可点性消费）。
    const mainView = h.manager.snapshot('s1');
    expect(mainView?.pendingChildren).toEqual(['s2']);
    expect(mainView?.pendingChildrenByTitle.get('任务一')).toBe('s2');

    // 两屏的流式按 sessionId 各达各屏，互不串扰。
    h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's1',
      runId: 'r1',
      text: '主会话正文',
    });
    h.eventBus.publish(EVENT_AGENT_STREAM_TEXT_DELTA, {
      sessionId: 's2',
      runId: 'child-run-1',
      text: '子会话正文',
    });
    jest.advanceTimersByTime(96);

    const mainBatches = mainScreen.streamPayloads.filter(
      p => (p as {type: string}).type === 'stream-batch',
    );
    const subBatches = subScreen.streamPayloads.filter(
      p => (p as {type: string}).type === 'stream-batch',
    );
    expect(mainBatches).toHaveLength(1);
    expect(subBatches).toHaveLength(1);
    expect(
      (mainBatches[0] as {segments: {kind: string; delta: string}[]}).segments,
    ).toEqual([{kind: 'text', delta: '主会话正文'}]);
    expect(
      (subBatches[0] as {segments: {kind: string; delta: string}[]}).segments,
    ).toEqual([{kind: 'text', delta: '子会话正文'}]);

    // 消费型单元不占 refcount：并行期间 refcount 只计发起方 run（=1）。
    expect(isMobileAgentActive()).toBe(true);
  });

  it('多会话并行逐个停止互不影响；全部停止后无残留（stopRun→abortRegistry.abort）', () => {
    // 两个发起型 run（s1/s3）并行 + abortRegistry 记录在途 controller
    // （abort 即摘除，模拟 core 的 unregister 时序）。
    const registryBySession = new Set(['s1', 's3']);
    h.manager.dispose();
    h = buildHarness({
      abortHas: sid => registryBySession.has(sid),
    });
    h.abortRegistry.abort.mockImplementation((sid: string) => {
      registryBySession.delete(sid);
    });

    h.manager.startRun('s1', 'p1', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
    });
    h.manager.startRun('s3', 'p1', 'hi');
    h.eventBus.publish(EVENT_AGENT_RUN_STARTED, {
      sessionId: 's3',
      projectId: 'p1',
      runId: 'r3',
    });

    expect(h.manager.activeSessionIds()).toEqual(['s1', 's3']);

    // 停止 s1（会话列表「停止生成」入口）：abort 只命中 s1，s3 不受影响。
    expect(h.manager.stopRun('s1')).toBe(true);
    expect(h.abortRegistry.abort).toHaveBeenCalledWith('s1');
    expect(h.abortRegistry.abort).toHaveBeenCalledTimes(1);
    // 停止后 core 发 FINISHED 收尾（事件路径）——s1 单元 settled、出活跃集。
    h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: 's1',
      projectId: 'p1',
      runId: 'r1',
      stopReason: 'end_turn',
    } as never);
    expect(h.manager.hasActiveRun('s1')).toBe(false);
    expect(h.manager.hasActiveRun('s3')).toBe(true);

    // 全部停止后：无 active 单元、refcount 归零。
    h.manager.stopRun('s3');
    h.eventBus.publish(EVENT_AGENT_RUN_FINISHED, {
      sessionId: 's3',
      projectId: 'p1',
      runId: 'r3',
      stopReason: 'end_turn',
    } as never);
    expect(h.manager.activeSessionIds()).toEqual([]);
    expect(isMobileAgentActive()).toBe(false);

    // 无在途 controller 的会话 stopRun 返回 false（不误触）。
    expect(h.manager.stopRun('s1')).toBe(false);
  });
});
