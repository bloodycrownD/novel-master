/**
 * T-CF7：ChatHistorySearchPanel 查询与「加载更早」互斥 + 请求序号守卫
 *        （desktop/C-orch-1）——append 进行中新查询、旧 append 响应晚到不落地。
 *
 * 为什么独立成文件（不在 chat-search-collapsible-form.test.tsx 里）：
 * 行为用例用根 node_modules 的 react-test-renderer（传递依赖，与根
 * node_modules/react 同副本）真渲组件；而桌面工作区自带另一份 react
 * （apps/desktop/node_modules/react），双副本会让 hooks dispatcher 为 null。
 * 这里先注册解析钩子（react-alias-hook.mjs）再把面板整棵依赖树动态导入进来，
 * 统一落到根副本上；而静态断言类测试（renderToStaticMarkup）用的是工作区副本，
 * 两套不能混在一个进程里（模块缓存共享），node --test 按文件分进程，天然隔离。
 *
 * 受控时序 mock：拦在 window.novelMasterDesktop.invoke（ipcMessagesSearch 底层
 * 出口），每次调用挂起、由测试决定何时放行，模拟「旧响应晚到」。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { ChatMessageDto } from "@shared/ipc-types";
import TestRenderer, {
  type ReactTestRenderer,
  type ReactTestRendererRoot,
} from "react-test-renderer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(__dirname, "..", "renderer");

function readPanel(): string {
  return readFileSync(
    join(rendererRoot, "features", "chat", "ChatHistorySearchPanel.tsx"),
    "utf8",
  );
}

// 见文件头注释：先注册钩子，再动态导入 act 与面板（整棵依赖树统一根 react 副本）。
register(new URL("./react-alias-hook.mjs", import.meta.url));
const { act } = await import("react");
const { ChatHistorySearchPanel } = await import(
  "@/features/chat/ChatHistorySearchPanel"
);

/** 构造最小可用 ChatMessageDto（contentBlocks 只放一个 TextBlock）。 */
function makeMessage(
  overrides: Partial<ChatMessageDto> & { id: string; text: string },
): ChatMessageDto {
  return {
    sessionId: "s1",
    seq: 1,
    role: "user",
    hidden: false,
    createdAtMs: 1,
    contentBlocks: [{ type: "text", text: overrides.text }],
    ...overrides,
  } as ChatMessageDto;
}

describe("ChatHistorySearchPanel 查询/加载更早互斥与竞态守卫 (T-CF7)", () => {
  /** 批量构造 seq 递减的消息（与搜索结果的 seq DESC 排序一致）。 */
  function makeBatch(count: number, baseSeq: number): ChatMessageDto[] {
    return Array.from({ length: count }, (_, i) =>
      makeMessage({
        id: `m-${baseSeq - i}`,
        seq: baseSeq - i,
        text: `消息 ${baseSeq - i}`,
      }),
    );
  }

  function submitForm(root: ReactTestRendererRoot): void {
    root
      .findByProps({ className: "chat-history-search__form" })
      .props.onSubmit({ preventDefault() {} });
  }

  it("源码：两按钮互斥 + 请求序号守卫存在", () => {
    const src = readPanel();
    // 查询与加载更早按钮均 disabled={loading || loadingMore}
    const matches = src.match(/disabled=\{loading \|\| loadingMore\}/g);
    assert.equal(matches?.length, 2);
    // 发请求前自增序号，响应落地前校验
    assert.match(src, /\+\+requestSeqRef\.current/);
    assert.match(src, /seq !== requestSeqRef\.current/);
  });

  it("append 进行中新查询：旧 append 响应晚到不落地，列表只含新查询结果", async () => {
    const pending: Array<
      (value: { ok: true; data: ChatMessageDto[] }) => void
    > = [];
    const g = globalThis as unknown as {
      window?: unknown;
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    };
    const prevWindow = g.window;
    const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
    g.window = {
      novelMasterDesktop: {
        invoke: () =>
          new Promise((resolve) => {
            pending.push(resolve);
          }),
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
      const root = renderer.root;

      // 首次查询：命中 SEARCH_LIMIT(50) 条 → 出现「加载更早」，表单自动收起
      await act(async () => submitForm(root));
      assert.equal(pending.length, 1);
      await act(async () => {
        pending[0]!({ ok: true, data: makeBatch(50, 1000) });
      });
      // 收起后重新展开表单，准备后续查询
      await act(async () => {
        root
          .findByProps({
            "data-session-detail-action": "search-history-filter-toggle",
          })
          .props.onClick();
      });

      // 「加载更早」(append) 发出后挂起不 resolve
      await act(async () => {
        root
          .findByProps({
            "data-session-detail-action": "search-history-load-more",
          })
          .props.onClick();
      });
      assert.equal(pending.length, 2);
      // 互斥：append 进行中两按钮均 disabled
      assert.equal(
        root
          .findByProps({ "data-session-detail-action": "search-history-submit" })
          .props.disabled,
        true,
      );
      assert.equal(
        root
          .findByProps({ "data-session-detail-action": "search-history-load-more" })
          .props.disabled,
        true,
      );

      // 模拟按钮互斥兜不住的在途竞态：直接触发表单提交新查询
      await act(async () => submitForm(root));
      assert.equal(pending.length, 3);
      // 新查询响应先到 → 落地
      await act(async () => {
        pending[2]!({ ok: true, data: makeBatch(3, 500) });
      });
      // 旧 append 响应晚到 → 序号守卫丢弃，不拼接进新结果
      await act(async () => {
        pending[1]!({ ok: true, data: makeBatch(2, 900) });
      });

      const ids = root
        .findAll((node) => node.props["data-message-id"] != null)
        .map((node) => node.props["data-message-id"] as string);
      assert.deepEqual(ids, ["m-500", "m-499", "m-498"]);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      g.window = prevWindow;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    }
  });
});
