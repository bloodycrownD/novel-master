/**
 * FetchModelsModal 过滤输入框（fetch-models-filter spec T-FM5/6/7，Step 1）：
 * - T-FM5：输入即过滤（大小写不敏感，displayName/vendorModelId 双字段）+ 空结果分支「无匹配模型」。
 * - T-FM6：过滤只作用展示层——被过滤隐藏的勾选行仍计入「已选 N 项」，清空后勾选态不丢。
 * - T-FM7：关闭再打开弹窗，过滤词重置为空。
 *
 * 行为用例与 chat-search-race-guard.test.tsx 同范式：注册 react-alias-hook.mjs
 * 把整棵依赖树动态导入统一到根 react 副本上，用 react-test-renderer 真渲组件；
 * mock 拦在 window.novelMasterDesktop.invoke（ipc client 底层出口），按 channel 路由。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import TestRenderer, {
  type ReactTestRenderer,
  type ReactTestRendererRoot,
} from "react-test-renderer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(__dirname, "..", "renderer");

// 见文件头注释：先注册钩子，再动态导入 act 与组件（统一根 react 副本）。
register(new URL("./react-alias-hook.mjs", import.meta.url));
const { act } = await import("react");
const { FetchModelsModal } = await import(
  "@/features/settings/FetchModelsModal"
);

/** suggestList 返回的建议行（load 里按 !stale 过滤后映射成 rows）。 */
interface SuggestRow {
  vendorModelId: string;
  displayName?: string;
  stale?: boolean;
}

const SUGGESTIONS: SuggestRow[] = [
  { vendorModelId: "gpt-4o", displayName: "GPT-4o" },
  { vendorModelId: "gpt-4o-mini", displayName: "GPT-4o mini" },
  { vendorModelId: "claude-3-5-sonnet", displayName: "Claude 3.5 Sonnet" },
];

/** 拦在 ipc client 底层出口：fetch 恒成功，suggestList 回固定建议，save 恒成功。 */
function makeInvoke(
  suggestions: SuggestRow[],
  calls: string[] = [],
): (channel: string, payload: unknown) => Promise<unknown> {
  return (channel: string) => {
    calls.push(channel);
    if (channel === "nm:providerModels/fetch") {
      return Promise.resolve({ ok: true, data: undefined });
    }
    if (channel === "nm:providerModels/suggestList") {
      return Promise.resolve({ ok: true, data: suggestions });
    }
    if (channel === "nm:providerModels/save") {
      return Promise.resolve({ ok: true, data: undefined });
    }
    return Promise.reject(new Error(`测试未预期的 IPC channel: ${channel}`));
  };
}

/** 挂全局 window.novelMasterDesktop，返回还原函数。 */
function mockWindow(invoke: (channel: string, payload: unknown) => Promise<unknown>): () => void {
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

/** 挂载并等待 open effect 的 load 走完（fetch + suggestList 均已落地）。 */
async function mountModal(
  calls: string[],
  savedVendorIds: string[] = [],
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      <FetchModelsModal
        open
        providerId="p1"
        savedVendorIds={savedVendorIds}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
  });
  if (renderer == null) {
    throw new Error("渲染失败");
  }
  return renderer;
}

function rowButtons(root: ReactTestRendererRoot) {
  return root.findAll(
    (node) =>
      typeof node.props.className === "string" &&
      /^fetch-models-modal__row( |$)/.test(node.props.className),
  );
}

function rowClassNames(root: ReactTestRendererRoot): string[] {
  return rowButtons(root).map((node) => node.props.className as string);
}

/** 过滤输入框写入（受控 input：onChange 只读 e.target.value，普通对象即可）。 */
async function typeQuery(root: ReactTestRendererRoot, value: string): Promise<void> {
  await act(async () => {
    root.findByProps({ className: "fetch-models-modal__filter" }).props.onChange({
      target: { value },
    });
  });
}

/** 点击某个模型行（按行标题文案定位行按钮）。 */
async function clickRow(root: ReactTestRendererRoot, title: string): Promise<void> {
  await act(async () => {
    const btn = rowButtons(root).find((node) =>
      node
        .findAll(
          (child) => child.props.className === "fetch-models-modal__row-title",
        )
        .some((titleNode) =>
          (titleNode.children as unknown[]).some(
            (text) => typeof text === "string" && text.includes(title),
          ),
        ),
    );
    assert.ok(btn != null, `未找到模型行：${title}`);
    btn.props.onClick();
  });
}

/** 「已选 N 项」计数的数字（无计数元素时返回 undefined）。 */
function selectedCountText(root: ReactTestRendererRoot): string | undefined {
  const countNode = root
    .findAll(
      (node) => node.props.className === "fetch-models-modal__count",
    )
    .at(0);
  return countNode == null
    ? undefined
    : (countNode.children as unknown[]).map((c) => String(c)).join("");
}

/** 状态行文案（「无匹配模型」/「未拉取到可用模型…」）。 */
function statusText(root: ReactTestRendererRoot): string | undefined {
  const statusNode = root
    .findAll((node) => node.props.className === "fetch-models-modal__status")
    .at(0);
  return statusNode == null
    ? undefined
    : (statusNode.children as unknown[]).map((c) => String(c)).join("");
}

describe("FetchModelsModal 过滤输入框 (T-FM5-8)", () => {
  it("T-FM5：输入即过滤（大小写不敏感双字段）+ 空结果「无匹配模型」+ 清空恢复", async () => {
    const calls: string[] = [];
    const restore = mockWindow(makeInvoke(SUGGESTIONS, calls));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountModal(calls);
      const root = renderer.root;
      // 初始全量 3 行，过滤框为空
      assert.equal(rowClassNames(root).length, 3);
      assert.equal(
        root.findByProps({ className: "fetch-models-modal__filter" }).props.value,
        "",
      );

      // 大小写混合关键字：命中 displayName 含 GPT 的两行
      await typeQuery(root, "gpT");
      assert.equal(rowClassNames(root).length, 2);
      assert.equal(statusText(root), undefined);

      // vendorModelId 命中（displayName 不含 sonnet，id 含）
      await typeQuery(root, "sonnet");
      assert.equal(rowClassNames(root).length, 1);

      // 无命中：空结果分支，文案区别于「未拉取到可用模型」
      await typeQuery(root, "zzz");
      assert.equal(rowClassNames(root).length, 0);
      assert.equal(statusText(root), "无匹配模型");
      assert.notEqual(statusText(root), "未拉取到可用模型");

      // 清空恢复全量
      await typeQuery(root, "");
      assert.equal(rowClassNames(root).length, 3);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("T-FM6：过滤隐藏已勾选行后，勾选态与「已选 N 项」计数不随过滤收缩", async () => {
    const calls: string[] = [];
    const restore = mockWindow(makeInvoke(SUGGESTIONS, calls));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountModal(calls);
      const root = renderer.root;

      // 勾选两行 GPT
      await clickRow(root, "GPT-4o");
      await clickRow(root, "GPT-4o mini");
      assert.equal(selectedCountText(root), "已选 2 项");

      // 过滤到只剩 Claude：两行 GPT 被隐藏，计数仍按全部勾选计
      await typeQuery(root, "claude");
      assert.equal(rowClassNames(root).length, 1);
      assert.equal(selectedCountText(root), "已选 2 项");

      // 清空过滤：勾选态不丢
      await typeQuery(root, "");
      const selected = rowClassNames(root).filter((c) =>
        c.includes("is-selected"),
      );
      assert.equal(selected.length, 2);
      assert.equal(selectedCountText(root), "已选 2 项");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("T-FM7：关闭再打开弹窗，过滤词重置为空、列表恢复全量", async () => {
    const calls: string[] = [];
    const restore = mockWindow(makeInvoke(SUGGESTIONS, calls));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountModal(calls);
      const root = renderer.root;

      await typeQuery(root, "gpt");
      assert.equal(rowClassNames(root).length, 2);

      // 关闭（open=false 不渲染）
      await act(async () => {
        renderer?.update(
          <FetchModelsModal
            open={false}
            providerId="p1"
            savedVendorIds={[]}
            onClose={() => {}}
            onSaved={() => {}}
          />,
        );
      });

      // 重新打开：open effect 重置过滤词并重拉列表
      const invokeCountBefore = calls.length;
      await act(async () => {
        renderer?.update(
          <FetchModelsModal
            open
            providerId="p1"
            savedVendorIds={[]}
            onClose={() => {}}
            onSaved={() => {}}
          />,
        );
      });
      assert.ok(calls.length > invokeCountBefore, "重开应重新走 load");
      assert.equal(
        root.findByProps({ className: "fetch-models-modal__filter" }).props.value,
        "",
      );
      assert.equal(rowClassNames(root).length, 3);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  // T-FM8：is-saved（已添加）行同样参与过滤——匹配则显示（禁用态），不匹配则隐藏（PRD 验收第 4 条）
  it("T-FM8: is-saved 行参与过滤", async () => {
    const calls: string[] = [];
    const restore = mockWindow(makeInvoke(SUGGESTIONS, calls));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountModal(calls, ["gpt-4o"]);
      const root = renderer.root;

      // 过滤 "gpt"：saved 行（gpt-4o）匹配则显示，与 mini 并列
      await typeQuery(root, "gpt");
      assert.equal(rowClassNames(root).length, 2);

      // 过滤 "claude"：saved 行不匹配被隐藏
      await typeQuery(root, "claude");
      assert.equal(rowClassNames(root).length, 1);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });
});

describe("FetchModelsModal 全选/全不选 (T-FM9-11)", () => {
  /** 点击「全选/全不选」按钮（fetch-models-modal__select-all）。 */
  async function clickSelectAll(root: ReactTestRendererRoot): Promise<void> {
    await act(async () => {
      const btn = root.findByProps({ className: "fetch-models-modal__select-all" });
      assert.equal(btn.props.disabled, false, "全选按钮应可用");
      btn.props.onClick();
    });
  }

  function selectAllLabel(root: ReactTestRendererRoot): string {
    const btn = root.findByProps({ className: "fetch-models-modal__select-all" });
    return (btn.children as unknown[]).map((c) => String(c)).join("");
  }

  it("T-FM9：全选选中全部未保存行，再点变全不选并清空", async () => {
    const calls: string[] = [];
    const restore = mockWindow(makeInvoke(SUGGESTIONS, calls));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountModal(calls);
      const root = renderer.root;

      assert.equal(selectAllLabel(root), "全选");
      await clickSelectAll(root);
      assert.equal(
        rowClassNames(root).filter((c) => c.includes("is-selected")).length,
        3,
      );
      assert.equal(selectedCountText(root), "已选 3 项");
      assert.equal(selectAllLabel(root), "全不选");

      await clickSelectAll(root);
      assert.equal(
        rowClassNames(root).filter((c) => c.includes("is-selected")).length,
        0,
      );
      assert.equal(selectedCountText(root), "已选 0 项");
      assert.equal(selectAllLabel(root), "全选");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("T-FM10：全选只作用未保存行，已添加行不选中", async () => {
    const calls: string[] = [];
    const restore = mockWindow(makeInvoke(SUGGESTIONS, calls));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountModal(calls, ["gpt-4o"]);
      const root = renderer.root;

      // 全量全选：saved 的 gpt-4o 不参与，只选中剩下 2 行
      await clickSelectAll(root);
      assert.equal(selectedCountText(root), "已选 2 项");
      assert.ok(
        rowClassNames(root)[0].includes("is-saved") &&
          !rowClassNames(root)[0].includes("is-selected"),
        "saved 行不应被选中",
      );

      // 过滤 "gpt"：可选行只剩 mini 且已选 → 文案切为全不选，点击后连同隐藏的 claude 一起清空
      await typeQuery(root, "gpt");
      assert.equal(selectAllLabel(root), "全不选");
      await clickSelectAll(root);
      await typeQuery(root, "");
      assert.equal(
        rowClassNames(root).filter((c) => c.includes("is-selected")).length,
        0,
      );
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });

  it("T-FM11：过滤后全选重置为「过滤后可选行全选」，被过滤隐藏的旧勾选不混入", async () => {
    const calls: string[] = [];
    const restore = mockWindow(makeInvoke(SUGGESTIONS, calls));
    let renderer: ReactTestRenderer | undefined;
    try {
      renderer = await mountModal(calls);
      const root = renderer.root;

      // 先勾选 claude，再过滤 gpt 后全选：勾选重置为过滤后可选的两行 gpt，claude 被清掉
      await clickRow(root, "Claude 3.5 Sonnet");
      await typeQuery(root, "gpt");
      await clickSelectAll(root);
      assert.equal(selectedCountText(root), "已选 2 项");
      assert.equal(selectAllLabel(root), "全不选");

      // 清空过滤：只有两行 gpt 选中，claude 不选
      await typeQuery(root, "");
      const selected = rowClassNames(root).filter((c) => c.includes("is-selected"));
      assert.equal(selected.length, 2);
      assert.equal(selectedCountText(root), "已选 2 项");
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      restore();
    }
  });
});
