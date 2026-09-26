/**
 * useAgentStreamMetrics / useAgentStream 状态机用例（desktop-metrics/test-1，
 * 兼 data-1 收尾冲刷与 sampling-2 run 身份 reset 的回归护栏）。
 *
 * 为什么独立成文件：这些断言要真跑 effect（冻结发生在 effect 里，
 * renderToStaticMarkup 不执行 effect），而 react-test-renderer 来自根
 * node_modules（与根 react 同副本），桌面工作区自带另一份 react——双副本会让
 * hooks dispatcher 为 null。所以这里先注册 react-alias-hook.mjs，再把 react /
 * react-test-renderer / 待测 hook 动态导入，统一落到根副本；静态断言类文件
 * （use-agent-stream-metrics.test.ts）用工作区副本，两边不能混在一个进程里。
 *
 * 时钟与节拍：hook 内所有时刻取 Date.now()，用例替换成可控递增值；250ms 渲染
 * tick 的 setInterval 也在本文件内置换成不调度的桩（tick 只影响展示节拍，与
 * 断言无关），重渲染改由 renderer.update 显式驱动。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  EVENT_AGENT_RUN_FAILED,
  EVENT_AGENT_RUN_FINISHED,
  EVENT_AGENT_RUN_STARTED,
  EVENT_AGENT_STREAM_TEXT_DELTA,
  EVENT_AGENT_STREAM_USAGE,
} from "@novel-master/core/events";
import { CHARACTERS_PER_TOKEN_RATIO } from "@novel-master/core/provider";
import type { AgentStreamMetricsView } from "@/hooks/useAgentStreamMetrics";
import type { UseAgentStreamCallbacks } from "@/hooks/useAgentStream";
import type { ReactTestRenderer } from "react-test-renderer";

// 见文件头：先注册解析钩子，再动态导入 react 家族与 hook（整棵依赖树统一根副本）。
register(new URL("./react-alias-hook.mjs", import.meta.url));
const { act, useRef, useState } = await import("react");
const TestRenderer = (await import("react-test-renderer")).default;
const { useAgentStreamMetrics } = await import("@/hooks/useAgentStreamMetrics");
const { useAgentStream } = await import("@/hooks/useAgentStream");

/** 可控时钟：基准 + 递增。 */
const REAL_DATE_NOW = Date.now;
const REAL_SET_INTERVAL = globalThis.setInterval;
const T0 = 1_000_000;
let nowMs = T0;

function setNow(next: number): void {
  nowMs = next;
}

function advance(ms: number): void {
  nowMs += ms;
}

type ActGlobal = {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  window?: unknown;
};

let prevActEnv: boolean | undefined;
let prevWindow: unknown;

beforeEach(() => {
  nowMs = T0;
  Date.now = () => nowMs;
  // 250ms 渲染 tick 换成不调度的桩（clearInterval 仍走真实实现，0 是合法 id）。
  globalThis.setInterval = (() => 0) as unknown as typeof globalThis.setInterval;
  const g = globalThis as ActGlobal;
  prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  prevWindow = g.window;
  g.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  Date.now = REAL_DATE_NOW;
  globalThis.setInterval = REAL_SET_INTERVAL;
  const g = globalThis as ActGlobal;
  g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
  g.window = prevWindow;
});

// ===== 一、metrics hook 直驱（宿主组件） =====

type MetricsHookApi = {
  readonly metrics: AgentStreamMetricsView | null;
  readonly noteTextDelta: (delta: string) => void;
  readonly noteThinkingDelta: (delta: string) => void;
  readonly noteUsage: (completionTokens: number) => void;
};

type MetricsHostProps = {
  readonly box: { api: MetricsHookApi | null };
  readonly running: boolean;
  readonly runKey: string;
  /** 帧号：note* 不发 state，读新累计值要靠显式 update 触发重渲染。 */
  readonly frame: number;
};

function MetricsHost({ box, running, runKey }: MetricsHostProps) {
  box.api = useAgentStreamMetrics(running, runKey);
  return null;
}

function createMetricsHarness() {
  const box: { api: MetricsHookApi | null } = { api: null };
  let renderer: ReactTestRenderer | undefined;
  const element = (running: boolean, runKey: string, frame: number) => (
    <MetricsHost box={box} running={running} runKey={runKey} frame={frame} />
  );
  return {
    api(): MetricsHookApi {
      assert.ok(box.api != null, "hook 未挂载");
      return box.api;
    },
    async render(running: boolean, runKey: string, frame = 0): Promise<void> {
      await act(async () => {
        renderer = TestRenderer.create(element(running, runKey, frame));
      });
    },
    async refresh(running: boolean, runKey: string, frame: number): Promise<void> {
      await act(async () => {
        renderer?.update(element(running, runKey, frame));
      });
    },
    async unmount(): Promise<void> {
      await act(async () => {
        renderer?.unmount();
      });
    },
  };
}

describe("useAgentStreamMetrics 状态机（desktop-metrics/test-1）", () => {
  it("收尾冻结速率=末值窗口，不随停顿衰减", async () => {
    const h = createMetricsHarness();
    try {
      await h.render(true, "s1:r1");
      const api = h.api();
      // 每 100 字符 ≈ ceil(100/3.35)=30 token，1s 一读 → 30 t/s
      api.noteTextDelta("字".repeat(100));
      advance(1_000);
      api.noteTextDelta("字".repeat(100));
      advance(1_000);
      api.noteTextDelta("字".repeat(100));
      await h.refresh(true, "s1:r1", 1);
      assert.equal(h.api().metrics?.tokensPerSecond, 30);

      // 停顿 3s 后收尾：live 读数会衰减，冻结值必须是末段稳态速率
      advance(3_000);
      await h.refresh(false, "s1:r1", 2);
      const frozen = h.api().metrics;
      assert.ok(frozen != null);
      assert.equal(frozen.running, false);
      assert.equal(frozen.completionTokens, 90);
      assert.equal(frozen.tokenSource, "heuristic");
      assert.equal(frozen.tokensPerSecond, 30);

      // 冻结快照不随时间变化（不衰减）
      advance(60_000);
      await h.refresh(false, "s1:r1", 3);
      assert.equal(h.api().metrics?.tokensPerSecond, 30);
    } finally {
      await h.unmount();
    }
  });

  it("noteUsage 覆盖 heuristic 并翻转 source，后续 delta 不回写", async () => {
    const h = createMetricsHarness();
    try {
      await h.render(true, "s1:r1");
      const api = h.api();
      api.noteTextDelta("字".repeat(335)); // ceil(335/3.35)=100
      await h.refresh(true, "s1:r1", 1);
      assert.equal(h.api().metrics?.completionTokens, 100);
      assert.equal(h.api().metrics?.tokenSource, "heuristic");

      api.noteUsage(777);
      await h.refresh(true, "s1:r1", 2);
      assert.equal(h.api().metrics?.completionTokens, 777);
      assert.equal(h.api().metrics?.tokenSource, "usage");

      // 真值已到：字符继续累计，但 token 不再被 heuristic 回写
      api.noteTextDelta("字".repeat(335));
      await h.refresh(true, "s1:r1", 3);
      const metrics = h.api().metrics;
      assert.ok(metrics != null);
      assert.equal(metrics.completionTokens, 777);
      assert.equal(metrics.tokenSource, "usage");
      assert.equal(metrics.textChars, 670);
    } finally {
      await h.unmount();
    }
  });

  it("新 run 身份不参与上一轮样本，重置后首读为 0/null", async () => {
    const h = createMetricsHarness();
    try {
      await h.render(true, "s1:r1");
      const api = h.api();
      api.noteTextDelta("字".repeat(100)); // 30 @T0
      advance(1_000);
      api.noteTextDelta("字".repeat(100)); // 60 @T0+1s
      advance(1_000);
      api.noteTextDelta("字".repeat(100)); // 90 @T0+2s
      await h.refresh(true, "s1:r1", 1);
      assert.equal(h.api().metrics?.tokensPerSecond, 30);

      // 同会话第二个 run：running 一路保持 true，只靠 run 身份变化触发重 seed
      setNow(T0 + 2_500);
      await h.refresh(true, "s1:r2", 2); // 身份变化 → effect 内 reset
      await h.refresh(true, "s1:r2", 3); // 重读 reset 后的渲染输出
      const reset = h.api().metrics;
      assert.ok(reset != null);
      assert.equal(reset.running, true);
      assert.equal(reset.completionTokens, 0);
      assert.equal(reset.tokenSource, "heuristic");
      assert.equal(reset.tokensPerSecond, null); // 不是上一轮残留

      // 新 run 自建窗口：30 t/s（若旧样本混入，同刻差分会被压成 0）
      api.noteTextDelta("字".repeat(100)); // 30 @T0+2.5s
      advance(1_000);
      api.noteTextDelta("字".repeat(100)); // 60 @T0+3.5s
      await h.refresh(true, "s1:r2", 4);
      assert.equal(h.api().metrics?.tokensPerSecond, 30);

      // 再收尾一次：冻结值取本轮末值，且采样序列随收尾一并清掉
      setNow(T0 + 4_000);
      await h.refresh(false, "s1:r2", 5);
      const settled = h.api().metrics;
      assert.ok(settled != null);
      assert.equal(settled.running, false);
      assert.equal(settled.completionTokens, 60);
      assert.equal(settled.tokensPerSecond, 30);

      setNow(T0 + 5_000);
      await h.refresh(true, "s1:r3", 6);
      await h.refresh(true, "s1:r3", 7);
      const third = h.api().metrics;
      assert.ok(third != null);
      assert.equal(third.running, true);
      assert.equal(third.completionTokens, 0);
      assert.equal(third.tokensPerSecond, null);
    } finally {
      await h.unmount();
    }
  });

  it("heuristic 折算严格等于 ceil(累计字符 / 3.35)", async () => {
    // 公式锚点：core 常量变更时必须在这里显式同步，防静默漂移
    assert.equal(CHARACTERS_PER_TOKEN_RATIO, 3.35);
    const h = createMetricsHarness();
    try {
      await h.render(true, "s1:r1");
      const api = h.api();
      api.noteTextDelta("a".repeat(100)); // 100/3.35=29.85 → 30
      await h.refresh(true, "s1:r1", 1);
      assert.equal(h.api().metrics?.completionTokens, 30);
      assert.equal(
        h.api().metrics?.completionTokens,
        Math.ceil(100 / CHARACTERS_PER_TOKEN_RATIO),
      );

      // 思考 delta 一并计入累计字符
      api.noteThinkingDelta("b".repeat(31)); // 131/3.35=39.10 → 40
      await h.refresh(true, "s1:r1", 2);
      assert.equal(h.api().metrics?.completionTokens, 40);
      assert.equal(
        h.api().metrics?.completionTokens,
        Math.ceil(131 / CHARACTERS_PER_TOKEN_RATIO),
      );
      assert.equal(h.api().metrics?.thinkingChars, 31);
    } finally {
      await h.unmount();
    }
  });
});

// ===== 二、useAgentStream × metrics 联动（data-1 收尾冲刷） =====

type StreamEnvelope = { readonly type: string; readonly payload: unknown };

/** 替换 renderer IPC 桥：捕获 agent stream 订阅，测试自行投递事件。 */
function installStreamBus() {
  const handlers: Array<(envelope: StreamEnvelope) => void> = [];
  (globalThis as ActGlobal).window = {
    novelMasterDesktop: {
      invoke: async () => ({ ok: true, data: null }),
      on: (
        _channel: string,
        callback: (envelope: StreamEnvelope) => void,
      ): (() => void) => {
        handlers.push(callback);
        return () => {
          const index = handlers.indexOf(callback);
          if (index >= 0) {
            handlers.splice(index, 1);
          }
        };
      },
    },
  };
  return {
    emit(envelope: StreamEnvelope): void {
      for (const handler of [...handlers]) {
        handler(envelope);
      }
    },
  };
}

type StreamBox = {
  metrics: AgentStreamMetricsView | null;
  /** noteUsage 到达序列（含节流冲刷）。 */
  usageNotes: number[];
  /** 收尾回调触发时刻已到达的 usage note 条数：1 = 冲刷先于 onRunFinished/Failed。 */
  notesAtFinish: number | null;
  begin?: (runId: string) => void;
};

/** 复刻 ConversationPanel 的装配形态：stream 单元 + metrics hook 同一宿主。 */
function StreamHost({ box }: { box: StreamBox }) {
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const runningRef = useRef(false);
  const runIdRef = useRef<string | null>(null);
  const callbacksRef = useRef<UseAgentStreamCallbacks>({
    acceptRunEvent: () => false,
    getUiRunning: () => false,
  });
  const metricsApi = useAgentStreamMetrics(running, `s1:${runId ?? ""}`);
  const { noteTextDelta, noteThinkingDelta, noteUsage } = metricsApi;
  useAgentStream({ sessionId: "s1", callbacksRef, batchEnabled: false });

  const applyRun = (next: boolean, id: string | null): void => {
    runningRef.current = next;
    runIdRef.current = id;
    setRunning(next);
    setRunId(id);
  };
  box.begin = (id: string) => applyRun(true, id);
  callbacksRef.current = {
    acceptRunEvent: (id) => id != null && id === runIdRef.current,
    getUiRunning: () => runningRef.current,
    noteTextDelta,
    noteThinkingDelta,
    noteUsage: (tokens: number) => {
      box.usageNotes.push(tokens);
      noteUsage(tokens);
    },
    onRunStarted: (payload) => applyRun(true, payload.runId),
    onRunFinished: () => {
      box.notesAtFinish = box.usageNotes.length;
      applyRun(false, null);
    },
    onRunFailed: () => {
      box.notesAtFinish = box.usageNotes.length;
      applyRun(false, null);
    },
  };
  box.metrics = metricsApi.metrics;
  return null;
}

function createStreamHarness(box: StreamBox) {
  let renderer: ReactTestRenderer | undefined;
  return {
    async mount(): Promise<void> {
      await act(async () => {
        renderer = TestRenderer.create(<StreamHost box={box} />);
      });
    },
    async unmount(): Promise<void> {
      await act(async () => {
        renderer?.unmount();
      });
    },
  };
}

function makeStreamBox(): StreamBox {
  return { metrics: null, usageNotes: [], notesAtFinish: null };
}

describe("useAgentStream × useAgentStreamMetrics 收尾冲刷（desktop-metrics/data-1）", () => {
  it("RUN_FINISHED 前冲刷 usage 节流：冻结取 usage 真值（openai 单步 run）", async () => {
    const bus = installStreamBus();
    const box = makeStreamBox();
    const h = createStreamHarness(box);
    try {
      await h.mount();
      // 发消息：beginUiRun 形态（running 先翻，RUN_STARTED 随后）
      await act(async () => {
        box.begin?.("r1");
      });
      await act(async () => {
        bus.emit({
          type: EVENT_AGENT_RUN_STARTED,
          payload: { sessionId: "s1", projectId: "p1", runId: "r1" },
        });
      });
      // 流中：heuristic 估值 + usage 真值（250ms 尾随节流暂存，未下发）
      await act(async () => {
        bus.emit({
          type: EVENT_AGENT_STREAM_TEXT_DELTA,
          payload: { sessionId: "s1", runId: "r1", text: "字".repeat(335) },
        });
        bus.emit({
          type: EVENT_AGENT_STREAM_USAGE,
          payload: {
            sessionId: "s1",
            runId: "r1",
            completionTokens: 777,
            source: "usage",
          },
        });
      });
      assert.deepEqual(box.usageNotes, [], "节流未到期，pending 应仍在途");

      await act(async () => {
        bus.emit({
          type: EVENT_AGENT_RUN_FINISHED,
          payload: { sessionId: "s1", runId: "r1", stopReason: "completed" },
        });
      });

      const frozen = box.metrics;
      assert.ok(frozen != null);
      assert.equal(frozen.running, false);
      assert.equal(frozen.completionTokens, 777, "冻结值应是 usage 真值而非 heuristic 估值");
      assert.equal(frozen.tokenSource, "usage");
      assert.deepEqual(box.usageNotes, [777]);
      assert.equal(box.notesAtFinish, 1, "冲刷必须先于 onRunFinished");
    } finally {
      await h.unmount();
    }
  });

  it("RUN_FAILED 同样先冲刷 pending（失败收尾不丢真值）", async () => {
    const bus = installStreamBus();
    const box = makeStreamBox();
    const h = createStreamHarness(box);
    try {
      await h.mount();
      await act(async () => {
        box.begin?.("r9");
      });
      await act(async () => {
        bus.emit({
          type: EVENT_AGENT_RUN_STARTED,
          payload: { sessionId: "s1", projectId: "p1", runId: "r9" },
        });
        bus.emit({
          type: EVENT_AGENT_STREAM_USAGE,
          payload: {
            sessionId: "s1",
            runId: "r9",
            completionTokens: 321,
            source: "usage",
          },
        });
      });
      assert.deepEqual(box.usageNotes, []);

      await act(async () => {
        bus.emit({
          type: EVENT_AGENT_RUN_FAILED,
          payload: { sessionId: "s1", runId: "r9", error: "boom" },
        });
      });

      const frozen = box.metrics;
      assert.ok(frozen != null);
      assert.equal(frozen.running, false);
      assert.equal(frozen.completionTokens, 321);
      assert.equal(frozen.tokenSource, "usage");
      assert.equal(box.notesAtFinish, 1, "冲刷必须先于 onRunFailed");
    } finally {
      await h.unmount();
    }
  });
});
