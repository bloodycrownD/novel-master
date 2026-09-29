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
import { createIncrementalTokenCounter } from "@shared/logic/format";
import type { IncrementalTokenCounter } from "@shared/logic/format";
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
  /** 可选实时 token 估算器工厂（②；缺省 = 启发式路径）。 */
  readonly estimatorFactory?:
    | (() => IncrementalTokenCounter | null)
    | undefined;
};

function MetricsHost({ box, running, runKey, estimatorFactory }: MetricsHostProps) {
  box.api = useAgentStreamMetrics(running, runKey, estimatorFactory);
  return null;
}

function createMetricsHarness(
  estimatorFactory?: () => IncrementalTokenCounter | null,
) {
  const box: { api: MetricsHookApi | null } = { api: null };
  let renderer: ReactTestRenderer | undefined;
  const element = (running: boolean, runKey: string, frame: number) => (
    <MetricsHost
      box={box}
      running={running}
      runKey={runKey}
      frame={frame}
      estimatorFactory={estimatorFactory}
    />
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
      // 每 100 字符 ≈ ceil(100/3.35)=30 token，1s 一读 → 30 tok/s
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

  it("noteUsage 重锚基线并翻转 source，后续 delta 的增量继续叠加", async () => {
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

      // 真值成为基线（777 − 100 = 677）：字符继续累计，增量继续叠加而不是
      // 冻结在真值上（677 + ceil(670/3.35)=200 → 877）。
      api.noteTextDelta("字".repeat(335));
      await h.refresh(true, "s1:r1", 3);
      const metrics = h.api().metrics;
      assert.ok(metrics != null);
      assert.equal(
        metrics.completionTokens,
        777 + (Math.ceil(670 / CHARACTERS_PER_TOKEN_RATIO) - 100),
      );
      assert.equal(metrics.tokenSource, "usage");
      assert.equal(metrics.textChars, 670);
    } finally {
      await h.unmount();
    }
  });

  it("多步 run：工具 step 静默后第二步文本流 token 继续增长、终态速率段不消失", async () => {
    const h = createMetricsHarness();
    try {
      await h.render(true, "s1:r1");
      const api = h.api();
      // step 1：每 1s 一条 100 字符 delta（≈30 tok/s），四条。
      for (let i = 0; i < 4; i += 1) {
        api.noteTextDelta("字".repeat(100));
        advance(1_000);
      }
      // step 1 done：run 级 usage 真值到达（同刻重锚）。
      api.noteUsage(600);
      await h.refresh(true, "s1:r1", 1);
      assert.equal(h.api().metrics?.completionTokens, 600);

      // 工具 step：无文本 delta，静默 3s（> 2.5s 速率窗口）。
      advance(3_000);
      // 第二步首条 delta：token 必须继续增长（旧实现冻结在 600）。
      api.noteTextDelta("字".repeat(100));
      await h.refresh(true, "s1:r1", 2);
      const afterStepTwoFirst = h.api().metrics;
      assert.ok(afterStepTwoFirst != null);
      assert.ok(
        afterStepTwoFirst.completionTokens > 600,
        `第二步 token 应继续增长：${afterStepTwoFirst.completionTokens}`,
      );

      // 第二步持续输出：新窗口成形，实时速率非空。
      for (let i = 0; i < 3; i += 1) {
        advance(1_000);
        api.noteTextDelta("字".repeat(100));
      }
      await h.refresh(true, "s1:r1", 3);
      const live = h.api().metrics;
      assert.ok(live != null);
      assert.ok(
        live.tokensPerSecond != null && live.tokensPerSecond > 20,
        `第二步实时速率应成形：${live.tokensPerSecond}`,
      );

      // 收尾冻结：速率段必须存在（旧实现跨 step 折叠成单样本 → null）。
      await h.refresh(false, "s1:r1", 4);
      const frozen = h.api().metrics;
      assert.ok(frozen != null);
      assert.equal(frozen.running, false);
      assert.ok(
        frozen.tokensPerSecond != null,
        "跨 step 静默后终态速率段不消失",
      );
      assert.ok(frozen.completionTokens > 600);
    } finally {
      await h.unmount();
    }
  });

  it("注入估算器（②）：token 由估算器给出，usage 重锚后增量继续叠加", async () => {
    // 假估算器：1 字符 = 1 token（与 ceil(chars/3.35) 可区分）。
    const h = createMetricsHarness(() => {
      let text = "";
      return {
        push(delta: string) {
          text += delta;
        },
        get tokens() {
          return text.length;
        },
        // 接口的必填诊断字段（core B-1 改法 #6）：假计数器不真的计数。
        get unencodableChars() {
          return 0;
        },
        reset() {
          text = "";
        },
      };
    });
    try {
      await h.render(true, "s1:r1");
      const api = h.api();
      api.noteTextDelta("abcd"); // 估算 4 tok（启发式会是 2 tok）
      await h.refresh(true, "s1:r1", 1);
      assert.equal(h.api().metrics?.completionTokens, 4);
      assert.equal(h.api().metrics?.tokenSource, "heuristic");

      // thinking 走另一条独立估算器。
      api.noteThinkingDelta("xy");
      await h.refresh(true, "s1:r1", 2);
      assert.equal(h.api().metrics?.completionTokens, 6);

      // usage 重锚：基线 = 100 − 6 = 94，后续增量继续叠加。
      api.noteUsage(100);
      api.noteTextDelta("efgh");
      await h.refresh(true, "s1:r1", 3);
      assert.equal(h.api().metrics?.completionTokens, 104);
      assert.equal(h.api().metrics?.tokenSource, "usage");
    } finally {
      await h.unmount();
    }
  });

  // ↓ 以下三条的**声明顺序有依赖**：工厂抛错的告警去重标志是模块级的
  // （`useAgentStreamMetrics.ts` 的 `warnedEstimatorFactoryFailure`，跨 run
  // 累积）。「工厂失败留告警」那条必须排在任何别的「抛错工厂」用例之前，
  // 否则它看到的是已被前序用例消耗掉的标志位、断言必然红。调换顺序请一并
  // 调整这里的顺序。
  it("工厂抛错：首次 console.warn 一次并带 err，后续同类失败不再打（去重）", async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]): void => {
      warnings.push(args);
    };
    try {
      // 每次调用都抛错（模拟编码表构造失败）。
      const h = createMetricsHarness(() => {
        throw new Error("js-tiktoken init failed");
      });
      try {
        await h.render(true, "s1:r1");
        // 回退行为不变：仍然出指标条，只是走启发式口径。
        h.api().noteTextDelta("字".repeat(335));
        await h.refresh(true, "s1:r1", 1);
        assert.equal(h.api().metrics?.completionTokens, 100);

        // 首次失败留痕：中文文案 + err 附参（此前该分支是空 catch，真机上
        // 「指标条一直是启发式数字」零信号，与 mobile 侧不对称）。
        assert.equal(warnings.length, 1);
        assert.match(String(warnings[0]?.[0]), /回退启发式/);
        assert.ok(warnings[0]?.[1] instanceof Error);

        // 第二个 run 再失败：去重，不再刷屏。
        await h.refresh(false, "s1:r1", 2);
        await h.refresh(true, "s1:r2", 3);
        h.api().noteTextDelta("字".repeat(335));
        await h.refresh(true, "s1:r2", 4);
        assert.equal(h.api().metrics?.completionTokens, 100);
        assert.equal(
          warnings.length,
          1,
          "同类失败只告警一次（去重标志跨 run 生效）",
        );
      } finally {
        await h.unmount();
      }
    } finally {
      console.warn = originalWarn;
    }
  });

  it("工厂返回 null 与工厂抛错：两条降级路径都整条回退启发式（②未注入口径）", async () => {
    // 前半：工厂返回 null（= 不可用，不抛错）。
    const nullFactory = createMetricsHarness(() => null);
    try {
      await nullFactory.render(true, "s1:r1");
      nullFactory.api().noteTextDelta("字".repeat(335));
      await nullFactory.refresh(true, "s1:r1", 1);
      assert.equal(
        nullFactory.api().metrics?.completionTokens,
        Math.ceil(335 / CHARACTERS_PER_TOKEN_RATIO),
        "工厂返回 null：回退启发式折算",
      );
      assert.equal(nullFactory.api().metrics?.tokenSource, "heuristic");
    } finally {
      await nullFactory.unmount();
    }

    // 后半：工厂抛错（已由上一条用例消耗掉一次性告警，这里只关心读值口径）。
    const throwingFactory = createMetricsHarness(() => {
      throw new Error("js-tiktoken init failed");
    });
    try {
      await throwingFactory.render(true, "s1:r1");
      throwingFactory.api().noteTextDelta("字".repeat(335));
      await throwingFactory.refresh(true, "s1:r1", 1);
      assert.equal(
        throwingFactory.api().metrics?.completionTokens,
        Math.ceil(335 / CHARACTERS_PER_TOKEN_RATIO),
        "工厂抛错：回退启发式折算（同样不阻断指标条）",
      );
      assert.equal(throwingFactory.api().metrics?.tokenSource, "heuristic");
    } finally {
      await throwingFactory.unmount();
    }
  });

  it("注入真计数器且 encode 对特殊段抛错：completionTokens 单调不减（B-1 端到端）", async () => {
    // 注入 core 真计数器（不是手写假实现），encode 对含 "!" 的段抛错——
    // 对应真机上 js-tiktoken 遇特殊 token 文本（disallowedSpecial="all"）。
    // 计数器跨过固化阈值时该段进入固化路径。
    const h = createMetricsHarness(() =>
      createIncrementalTokenCounter({
        encode: text => {
          if (text.includes("!")) {
            throw new Error("special token text");
          }
          return text.length;
        },
      }),
    );
    try {
      await h.render(true, "s1:r1");
      const api = h.api();
      const observed: number[] = [];
      // 默认 tailChars 24 + commitStepChars 64 = 88 触发固化；这里推入
      // 足够长的段落，确保跨越固化阈值。
      const segments = [
        "!".repeat(30),
        "a".repeat(60),
        "!".repeat(60),
        "b".repeat(60),
        "c".repeat(40),
      ];
      for (let i = 0; i < segments.length; i += 1) {
        api.noteTextDelta(segments[i]!);
        await h.refresh(true, "s1:r1", i + 1);
        observed.push(h.api().metrics?.completionTokens ?? -1);
      }
      // 逐段单调不减：固化段 encode 失败时按 1:1 兜底计入，读值不得倒退。
      for (let i = 1; i < observed.length; i += 1) {
        assert.ok(
          observed[i]! >= observed[i - 1]!,
          `completionTokens 不得回退：第 ${i} 段 ${observed[i]} < ${observed[i - 1]}`,
        );
      }
      // 末值等于累计字符数（1 字符 = 1 token，失败段 1:1 兜底 → 不丢段）。
      const totalChars = segments.reduce((sum, s) => sum + s.length, 0);
      assert.equal(observed[observed.length - 1], totalChars);
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

      // 新 run 自建窗口：30 tok/s（若旧样本混入，同刻差分会被压成 0）
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
