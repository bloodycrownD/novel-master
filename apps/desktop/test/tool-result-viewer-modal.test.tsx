/**
 * T-TRM：ToolResultViewerModal 监听壳（CR-4）。
 *
 * `dispatchOpenToolResultView` → CustomEvent → setTarget 这段若事件名两侧
 * 写错将静默失效（永远打不开），此前无守门。照 settings-overlay-request-close
 * .test.tsx 的 TestRenderer + 假 window 模式挂真实组件：假 window 捕获
 * OPEN_TOOL_RESULT_EVENT 注册，dispatch 真分发到 handler，断言 Modal 出现
 * / Esc 关闭 / 卸载后无泄漏。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import TestRenderer, {
  type ReactTestRenderer,
  type TestInstance,
} from "react-test-renderer";

register(new URL("./react-alias-hook.mjs", import.meta.url));
const { act } = await import("react");
const {
  ToolResultViewerModal,
  dispatchOpenToolResultView,
  OPEN_TOOL_RESULT_EVENT,
} = await import("@/features/chat/ToolResultViewer");

type Handler = (e: Event) => void;

function makeFakeWindow() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    addEventListener(type: string, cb: Handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(cb);
    },
    removeEventListener(type: string, cb: Handler) {
      handlers.get(type)?.delete(cb);
    },
    dispatchEvent(e: {type: string}) {
      for (const cb of handlers.get(e.type) ?? []) cb(e as Event);
      return true;
    },
    listenerCount(type: string) {
      return handlers.get(type)?.size ?? 0;
    },
  };
}

function dialogCount(root: TestInstance): number {
  return root.findAll((n) => n.props["role"] === "dialog", {deep: true}).length;
}

function dialogTitle(root: TestInstance): string {
  const title = root.findAll(
    (n) => String(n.props.className ?? "").includes("prompt-fullscreen__title"),
    {deep: true},
  )[0];
  assert.ok(title, "未找到标题节点");
  return String(title.props.children);
}

async function mount(): Promise<{
  renderer: ReactTestRenderer;
  fakeWindow: ReturnType<typeof makeFakeWindow>;
  restore: () => void;
}> {
  const g = globalThis as unknown as {
    window?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  const fakeWindow = makeFakeWindow();
  g.window = fakeWindow;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<ToolResultViewerModal />);
  });
  return {
    renderer: renderer!,
    fakeWindow,
    restore() {
      g.window = prevWindow;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    },
  };
}

describe("ToolResultViewerModal 监听壳 (T-TRM)", () => {
  it("T-TRM1: dispatchOpenToolResultView → Modal 打开，标题与正文来自载荷", async () => {
    const m = await mount();
    try {
      assert.equal(dialogCount(m.renderer.root), 0);
      await act(async () => {
        dispatchOpenToolResultView({title: "fs", content: "0 entries"});
      });
      assert.equal(dialogCount(m.renderer.root), 1);
      assert.equal(dialogTitle(m.renderer.root), "fs");
      const body = m.renderer.root.findAll(
        (n) => String(n.props.className ?? "").includes("prompt-fullscreen__raw"),
        {deep: true},
      )[0];
      assert.equal(body?.props.children, "0 entries");
    } finally {
      await act(async () => {
        m.renderer.unmount();
      });
      m.restore();
    }
  });

  it("T-TRM2: Esc keydown → Modal 关闭", async () => {
    const m = await mount();
    try {
      await act(async () => {
        dispatchOpenToolResultView({title: "search", content: "x"});
      });
      assert.equal(dialogCount(m.renderer.root), 1);
      // 合成事件须自带 type（分发按 type 查表路由）
      const esc = {
        type: "keydown",
        key: "Escape",
        defaultPrevented: false,
      } as KeyboardEvent;
      await act(async () => {
        m.fakeWindow.dispatchEvent(esc);
      });
      assert.equal(dialogCount(m.renderer.root), 0);
    } finally {
      await act(async () => {
        m.renderer.unmount();
      });
      m.restore();
    }
  });

  it("T-TRM3: 卸载后事件监听清理（无泄漏）", async () => {
    const m = await mount();
    await act(async () => {
      m.renderer.unmount();
    });
    m.restore();
    assert.equal(m.fakeWindow.listenerCount(OPEN_TOOL_RESULT_EVENT), 0);
  });
});
