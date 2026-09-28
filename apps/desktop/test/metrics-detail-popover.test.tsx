/**
 * MetricsDetailPopover / AgentStreamMetricsBar（metric-detail-sheet Step 3，
 * T-MD4 + T-MD2 端侧同源断言）：
 * - 指标条 button 化：role=button、aria-live 保留、onClick 触发回调；
 * - useSessionUsageDetail：mount 即发 {kind:"sessionDetail", filter:{}} 请求
 *   （filter 必填占位透传）、pending 加载态、响应后渲染数据（mock 拦在
 *   window.novelMasterDesktop.invoke 按 channel 路由，token-usage-stats-view
 *   范式）；
 * - MetricsDetailPanel 两段渲染：最近请求（模型/输入/输出/cache 拆分/命中率
 *   — 态——cache_creation 缺失显示「—」）+ 会话累计（可见消息数/工具调用/
 *   累计输入输出）+ 口径脚注；
 * - 「上下文占用」行与 chip 读数同源：渲染值 === 传入 contextUsageLabel
 *   （端侧复用不取新数，P0-2）；
 * - 空态：last/totals null 时出占位行。
 *
 * portal 外壳（createPortal + 定位 + 外点关闭）不在本套件：node:test 无
 * DOM，react-test-renderer 渲不了 portal（与 workspace-push 的 ContextMenu
 * stub 同理），交互面留给真机手工验收（Step 5）。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import TestRenderer, {
  type ReactTestRenderer,
} from "react-test-renderer";

// 先注册钩子，再动态导入 act 与组件（统一根 react 副本）。
register(new URL("./react-alias-hook.mjs", import.meta.url));
const { act } = await import("react");
const { AgentStreamMetricsBar } = await import(
  "@/features/chat/AgentStreamMetricsBar"
);
const {
  MetricsDetailPanel,
  useSessionUsageDetail,
} = await import("@/features/chat/MetricsDetailPopover");
const { ipcUsageStatsQuery } = await import("@/ipc/client");

/** 递归收集节点文本。 */
function collectText(node: { children?: unknown }): string {
  let out = "";
  for (const child of (node.children as unknown[]) ?? []) {
    if (typeof child === "string") {
      out += child;
    } else if (
      child != null &&
      typeof child === "object" &&
      "children" in child
    ) {
      out += collectText(child as { children?: unknown });
    }
  }
  return out;
}

/** 挂全局 window.novelMasterDesktop（invoke 按 channel 断言形态），返回还原函数。 */
function mockWindow(
  invoke: (channel: string, payload: unknown) => Promise<unknown>
): () => void {
  const g = globalThis as unknown as {
    window?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  g.window = { novelMasterDesktop: { invoke } };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
    g.window = prevWindow;
    g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
  };
}

const DETAIL_FIXTURE = {
  last: {
    seq: 7,
    modelName: "claude-x",
    provider: "anthropic",
    promptTokens: 1000,
    completionTokens: 4200,
    cacheReadTokens: 2048,
    // openai/gemini 类协议无 cache_creation：null → 展示「—」（T-MD4）
    cacheCreationTokens: null,
    atMs: 1_800_000_000_000,
  },
  totals: {
    promptTokens: 12_000,
    completionTokens: 8_000,
    cacheReadTokens: 2_048,
    cacheCreationTokens: 512,
    billedInputTokens: 3_600,
    assistantRows: 6,
  },
  visibleMessageCount: 11,
  toolUseCount: 4,
};

describe("AgentStreamMetricsBar button 化（T-MD4）", () => {
  it("根节点为 button：role=button、aria-live 保留、onClick 触发回调", () => {
    let renderer: ReactTestRenderer;
    const clicks: string[] = [];
    act(() => {
      renderer = TestRenderer.create(
        <AgentStreamMetricsBar
          metrics={{
            running: false,
            elapsedMs: 1_500,
            textChars: 33,
            thinkingChars: 0,
            completionTokens: 10,
            tokenSource: "usage",
            tokensPerSecond: null,
          }}
          onClick={() => clicks.push("open")}
        />
      );
    });
    const button = renderer!.root.findByType("button");
    assert.equal(button.props["aria-live"], "polite");
    act(() => {
      button.props.onClick();
    });
    assert.deepEqual(clicks, ["open"]);
  });
});

describe("useSessionUsageDetail 自取（T-MD4 加载态 + filter 占位）", () => {
  it("mount 即发 kind=sessionDetail + filter:{} 占位请求，pending → 数据落地", async () => {
    const requests: unknown[] = [];
    const restore = mockWindow(async (channel, payload) => {
      if (channel === "nm:usageStats/query") {
        requests.push(payload);
        return { ok: true, data: DETAIL_FIXTURE };
      }
      throw new Error(`unexpected channel: ${channel}`);
    });
    let renderer: ReactTestRenderer;
    let state:
      | { detail: unknown; loading: boolean; error: string | null }
      | undefined;
    function Probe() {
      state = useSessionUsageDetail("sess-1");
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });
    // 请求形态：filter 为必填字段，sessionDetail 携带空对象占位。
    assert.deepEqual(requests, [
      { kind: "sessionDetail", sessionId: "sess-1", filter: {} },
    ]);
    assert.equal(state!.loading, false);
    assert.deepEqual(state!.detail, DETAIL_FIXTURE);
    assert.equal(state!.error, null);
    // 独立通道复核：ipcUsageStatsQuery 原样携带 filter:{}。
    const direct = await ipcUsageStatsQuery({
      kind: "sessionDetail",
      sessionId: "sess-1",
      filter: {},
    });
    assert.equal(direct.ok, true);
    restore();
  });

  it("响应失败时落 error 文案而非数据", async () => {
    const restore = mockWindow(async (channel) => {
      if (channel === "nm:usageStats/query") {
        return { ok: false, error: { code: "ERROR", message: "库不可用" } };
      }
      throw new Error(`unexpected channel: ${channel}`);
    });
    let renderer: ReactTestRenderer;
    let state:
      | { detail: unknown; loading: boolean; error: string | null }
      | undefined;
    function Probe() {
      state = useSessionUsageDetail("sess-2");
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(<Probe />);
    });
    assert.equal(state!.loading, false);
    assert.equal(state!.error, "库不可用");
    assert.equal(state!.detail, null);
    restore();
  });
});

describe("MetricsDetailPanel 两段渲染（T-MD4 + T-MD2 同源断言）", () => {
  function mountPanel(props?: {
    detail?: unknown;
    loading?: boolean;
    error?: string | null;
    contextUsageLabel?: string | null;
  }): ReactTestRenderer {
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <MetricsDetailPanel
          detail={(props?.detail ?? DETAIL_FIXTURE) as never}
          loading={props?.loading ?? false}
          error={props?.error ?? null}
          contextUsageLabel={
            props?.contextUsageLabel === undefined
              ? "~1.2k / 200k"
              : props.contextUsageLabel
          }
        />
      );
    });
    return renderer!;
  }

  /** 取 data-row 键的行文本。 */
  function rowText(renderer: ReactTestRenderer, key: string): string {
    const node = renderer.root.findByProps({ "data-row": key });
    return collectText(node);
  }

  it("最近请求段：模型/输入/输出/cache 拆分；cache_creation 缺失显示「—」", () => {
    const renderer = mountPanel();
    assert.ok(rowText(renderer, "last-model").includes("claude-x"));
    // formatTokenCount 紧凑格式：1000→1K、4200→4.2K、2048→2K。
    assert.ok(rowText(renderer, "last-input").includes("1K"));
    assert.ok(rowText(renderer, "last-output").includes("4.2K"));
    assert.ok(rowText(renderer, "last-cache-read").includes("2K"));
    // anthropic 但 cache_creation 列为 null（协议缺失）：出「—」不出 0。
    assert.ok(rowText(renderer, "last-cache-creation").includes("—"));
    // 命中率 = 2048 / (1000 + 2048 + 0) ≈ 67%。
    assert.ok(rowText(renderer, "last-hit-rate").includes("67%"));
  });

  it("会话累计段：可见消息数/工具调用/累计输入输出 + 口径脚注", () => {
    const renderer = mountPanel();
    assert.ok(
      rowText(renderer, "totals-visible-messages").includes("11")
    );
    assert.ok(rowText(renderer, "totals-tool-use").includes("4"));
    assert.ok(rowText(renderer, "totals-input").includes("12K"));
    assert.ok(rowText(renderer, "totals-output").includes("8K"));
    const text = collectText(renderer.toJSON() as never);
    assert.ok(text.includes("累计含隐藏消息 · 消息数为可见口径"));
  });

  it("「上下文占用」行渲染值 === 传入读数（与 chip 同源，不取新数）", () => {
    const renderer = mountPanel({ contextUsageLabel: "~3.1k / 200k" });
    assert.ok(rowText(renderer, "context-usage").includes("~3.1k / 200k"));
  });

  it("空态：last/totals 为 null 时出占位行，上下文占用缺读取数出「—」", () => {
    const renderer = mountPanel({
      detail: {
        last: null,
        totals: null,
        visibleMessageCount: 0,
        toolUseCount: 0,
      },
      contextUsageLabel: null,
    });
    assert.ok(rowText(renderer, "last-empty").includes("暂无请求记录"));
    assert.ok(rowText(renderer, "totals-empty").includes("暂无累计数据"));
    assert.ok(rowText(renderer, "context-usage").includes("—"));
  });

  it("加载态与错误态：loading 出占位文案，error 透出消息", () => {
    const loadingRenderer = mountPanel({ loading: true });
    assert.ok(
      collectText(loadingRenderer.toJSON() as never).includes("加载中")
    );
    const errorRenderer = mountPanel({ error: "查询失败" });
    assert.ok(collectText(errorRenderer.toJSON() as never).includes("查询失败"));
  });
});
