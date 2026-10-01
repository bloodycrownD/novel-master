/**
 * N-P1-04：WorkspaceSettingsView 压缩条件防抖保存必须落库「最后一次击键」的值。
 *
 * 病灶：防抖定时器闭包捕获的是击键那一帧的 saveCompaction，
 * 而它读的是本次击键之前的 state ⇒ 600ms 后落库的是上一次的值，最后一次输入永远丢失。
 *
 * 断言的牙齿：把定时器回调改回 `void saveCompaction()`（读 state 的无参版），
 * T-CMPD-1/2 必须变红。
 *
 * ⚠️ mock.timers 必须显式限定 apis：Node v22 的默认档含 setImmediate，
 * 而 react-test-renderer 的 act() 靠 scheduler 的 setImmediate/MessageChannel 冲刷待办 work，
 * mock 掉后 act 永不返回（死因看起来像「实现把定时器删了」）。
 * ⚠️ 每次 tick 前先 `await act(async () => {})`，让 compactionDraftRef 的
 * passive effect 先落盘，否则读到的是上一帧的 ref 值。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it, type TestContext } from "node:test";
import TestRenderer, {
  type ReactTestRenderer,
  type ReactTestRendererRoot,
} from "react-test-renderer";

register(new URL("./react-alias-hook.mjs", import.meta.url));
register(new URL("./workspace-settings-shell-nav-hook.mjs", import.meta.url));
const { act } = await import("react");
const { WorkspaceSettingsView } = await import(
  "@/features/settings/WorkspaceSettingsView"
);

const SET_CHANNEL = "nm:compactionConditions/set";
const GET_CHANNEL = "nm:compactionConditions/get";

/**
 * 首屏 refresh() 逐通道应答。picker 类通道的 data 为 null 会让
 * `.data.rows.map` 抛错并中断 refresh（后续 setState 全不执行），
 * 所以这里必须给足形状。
 */
function okFor(channel: string): unknown {
  switch (channel) {
    case "nm:agent/resolveCurrent":
      return { ok: true, data: { agentId: "a1", agentName: "通用" } };
    case "nm:model/listPicker":
      return {
        ok: true,
        data: { rows: [{ savedModelId: "m1", label: "模型一" }], currentId: "m1" },
      };
    case "nm:app-ui/get":
      return { ok: true, data: "true" };
    case GET_CHANNEL:
      return {
        ok: true,
        data: { schemaVersion: 4, enabled: true, tokenRatio: 0.8, hideStartDepth: 6 },
      };
    default:
      return { ok: true, data: true };
  }
}

type CompactionConditions = {
  schemaVersion: number;
  enabled: boolean;
  tokenRatio?: number;
  hideStartDepth?: number;
};
type SetCall = { conditions: CompactionConditions };

type Mounted = {
  root: ReactTestRendererRoot;
  renderer: ReactTestRenderer;
  setCalls: SetCall[];
  restore: () => void;
};

/** 挂载组件并等首屏 refresh() 落定，返回 root 与录到的 set 载荷数组。 */
async function mount(t: TestContext): Promise<Mounted> {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1_000 });
  const setCalls: SetCall[] = [];
  const g = globalThis as unknown as {
    window?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  g.window = {
    novelMasterDesktop: {
      invoke: async (channel: string, arg?: unknown) => {
        if (channel === SET_CHANNEL) {
          setCalls.push(arg as SetCall);
          return { ok: true };
        }
        return okFor(channel);
      },
    },
  };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<WorkspaceSettingsView />);
  });
  // 首屏 refresh() 的 promise 落定 + passive effect 全部跑完
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    root: renderer!.root,
    renderer: renderer!,
    setCalls,
    restore: () => {
      g.window = prevWindow;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    },
  };
}

/** hideStartDepth 输入框：type=number 且无 step；tokenRatio 带 step="0.01"。 */
function findNumberInput(
  root: ReactTestRendererRoot,
  step: string | null,
): { props: { onChange: (e: { target: { value: string } }) => void } } {
  const inputs = root.findAll(
    (n) => n.type === "input" && n.props.type === "number" && (n.props.step ?? null) === step,
    { deep: true },
  );
  const found = inputs[0];
  assert.ok(found, `未找到 step=${String(step)} 的 type=number 输入框`);
  return found as unknown as {
    props: { onChange: (e: { target: { value: string } }) => void };
  };
}

async function cleanup(t: TestContext, mounted: Mounted): Promise<void> {
  await act(async () => {
    mounted.renderer.unmount();
  });
  mounted.restore();
  t.mock.timers.reset();
}

describe("WorkspaceSettingsView 压缩防抖保存 (N-P1-04)", () => {
  it("T-CMPD-1 落库的是最后一次击键的 tokenRatio", async (t) => {
    const mounted = await mount(t);
    try {
      const ratio = findNumberInput(mounted.root, "0.01");
      for (const value of ["0.8", "0.85", "0.855"]) {
        await act(async () => {
          ratio.props.onChange({ target: { value } });
        });
        // 让 passive effect（compactionDraftRef 同步）先落盘
        await act(async () => {});
      }
      await act(async () => {});
      t.mock.timers.tick(600);
      await act(async () => {});
      assert.equal(mounted.setCalls.length, 1);
      assert.equal(mounted.setCalls[0]!.conditions.tokenRatio, 0.855);
    } finally {
      await cleanup(t, mounted);
    }
  });

  it("T-CMPD-2 落库的是最后一次击键的 hideStartDepth", async (t) => {
    const mounted = await mount(t);
    try {
      const depth = findNumberInput(mounted.root, null);
      for (const value of ["6", "7"]) {
        await act(async () => {
          depth.props.onChange({ target: { value } });
        });
        await act(async () => {});
      }
      await act(async () => {});
      t.mock.timers.tick(600);
      await act(async () => {});
      assert.equal(mounted.setCalls.length, 1);
      assert.equal(mounted.setCalls[0]!.conditions.hideStartDepth, 7);
    } finally {
      await cleanup(t, mounted);
    }
  });

  it("T-CMPD-3 599ms 未到点不落库（防抖语义保持）", async (t) => {
    const mounted = await mount(t);
    try {
      const depth = findNumberInput(mounted.root, null);
      for (const value of ["6", "7", "8"]) {
        await act(async () => {
          depth.props.onChange({ target: { value } });
        });
        await act(async () => {});
      }
      await act(async () => {});
      t.mock.timers.tick(599);
      await act(async () => {});
      assert.equal(mounted.setCalls.length, 0);
    } finally {
      await cleanup(t, mounted);
    }
  });

  it("T-CMPD-4 开关那一路仍即时落库且取当前帧值", async (t) => {
    const mounted = await mount(t);
    try {
      // 「启用自动压缩」的 Switch 是渲染树里最后一个 checkbox
      // （前四个是父/子会话流式、思考提示词、富文本消息）。
      const checkboxes = mounted.root.findAll(
        (n) => n.type === "input" && n.props.type === "checkbox",
        { deep: true },
      );
      const toggle = checkboxes[checkboxes.length - 1];
      assert.ok(toggle, "未找到自动压缩开关");
      await act(async () => {
        (toggle as unknown as { props: { onChange: (e: { target: { checked: boolean } }) => void } })
          .props.onChange({ target: { checked: false } });
      });
      await act(async () => {});
      assert.equal(mounted.setCalls.length, 1);
      // 当前帧值：tokenRatio 0.8（首屏 get 载入）、hideStartDepth 6
      assert.equal(mounted.setCalls[0]!.conditions.enabled, false);
      assert.equal(mounted.setCalls[0]!.conditions.tokenRatio, 0.8);
      assert.equal(mounted.setCalls[0]!.conditions.hideStartDepth, 6);
    } finally {
      await cleanup(t, mounted);
    }
  });
});
