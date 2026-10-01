/**
 * T-CSErr-1：ChatHistorySearchPanel 查询失败时不得白屏，且渲染 error.message。
 *
 * 病灶：runQuery 的失败分支把 IpcErrorPayload 对象塞进 string state，
 * 随后 {error} 作为 React 子节点渲染 ⇒ "Objects are not valid as a React child"
 * ⇒ 异常冒到 React 18 root（renderer/ 内无 ErrorBoundary）⇒ 整个窗口空白。
 *
 * 为什么独立成文件：race-guard 用例的 invoke mock 是「挂起 + 测试放行」的受控时序形态，
 * 不便直接返回 ok:false。node --test 按文件分进程 ⇒ 双 react 副本天然隔离。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import TestRenderer, {
  type ReactTestRenderer,
  type TestInstance,
} from "react-test-renderer";

register(new URL("./react-alias-hook.mjs", import.meta.url));
register(new URL("./chat-search-shell-nav-hook.mjs", import.meta.url));
const { act } = await import("react");
const { ChatHistorySearchPanel } = await import(
  "@/features/chat/ChatHistorySearchPanel"
);

const MESSAGES_SEARCH = "nm:messages/search";

/** 递归收集渲染树里的全部文本节点。 */
function collectText(node: TestInstance | string | null, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  for (const child of node.children ?? []) {
    collectText(child, out);
  }
  return out;
}

describe("ChatHistorySearchPanel 查询失败渲染 (T-CSErr)", () => {
  async function renderWithInvoke(
    invokeResult: unknown,
  ): Promise<{ texts: string[]; alertCount: number; renderer: ReactTestRenderer }> {
    const g = globalThis as unknown as {
      window?: unknown;
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const prevWindow = g.window;
    const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
    g.window = {
      novelMasterDesktop: {
        invoke: async (channel: string) => {
          if (channel === MESSAGES_SEARCH) return invokeResult;
          return { ok: true, data: null };
        },
      },
    };
    g.IS_REACT_ACT_ENVIRONMENT = true;

    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          <ChatHistorySearchPanel
            projectId="p1"
            sessionId="s1"
            onClose={() => {}}
          />,
        );
      });
      const root = renderer!.root;
      await act(async () => {
        const onSubmit = root.findByProps({
          className: "chat-history-search__form",
        }).props["onSubmit"] as (e: unknown) => void;
        onSubmit({ preventDefault() {} });
      });
      const texts = collectText(renderer!.toJSON() as TestInstance | null);
      const alertCount = root.findAll(
        (n) => n.props["role"] === "alert",
        { deep: true },
      ).length;
      return { texts, alertCount, renderer: renderer! };
    } finally {
      // 交给调用方在断言后卸载；此处只还原全局
      g.window = prevWindow;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    }
  }

  it("IPC 返回 ok:false 时不抛异常，渲染 error.message", async () => {
    let renderer: ReactTestRenderer | undefined;
    try {
      const out = await renderWithInvoke({
        ok: false,
        error: { code: "VFS_ERROR", message: "查询失败：库被占用" },
      });
      renderer = out.renderer;
      assert.equal(out.alertCount, 1);
      assert.ok(
        out.texts.some((t) => t.includes("查询失败：库被占用")),
        `应渲染 error.message，实际文本：${JSON.stringify(out.texts)}`,
      );
      // {error} 位置不是对象：role=alert 节点的 children 全为字符串
      const alertNode = renderer.root.findAll(
        (n) => n.props["role"] === "alert",
        { deep: true },
      )[0]!;
      const alertTexts = collectText(alertNode).join("");
      assert.equal(alertTexts, "查询失败：库被占用");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
    }
  });
});
