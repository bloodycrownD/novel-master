/**
 * T-SD04-3：SettingsOverlay 的 ⚙ 关闭走 handleClose（守卫 + onClose 副作用单点）。
 *
 * 病灶（S-D-04）：App 顶栏 ⚙ 原来是 `setSettingsOpen(open => !open)`，
 * 绕过 Overlay 内的 handleClose ⇒ ① 脏表单确认弹窗不弹；② onClose 副作用
 * （notifyAgentConfigChanged，聊天侧/我的页的智能体列表刷新）不跑。
 *
 * 观测面：`onClose` 的调用次数 + `role="alertdialog"` 是否可见（守卫弹窗），
 * 以及句柄 `requestClose` 是否真的落到 handleClose 上——**不依赖任何静态断言**。
 * （App.tsx 那行接线本身由 settings-agents-tabs.test.ts 的静态守卫兜底。）
 *
 * 依赖树处理：SettingsOverlay 静态 import 了 9 个 view 模块（各自牵 core 的
 * 一大片），用解析钩子把它们统统重定向到 no-op stub，让本用例只聚焦 Overlay
 * 壳层（导航 / 守卫 / 关闭）。stub 把收到的 nav 句柄记进 seenNavs，
 * 本用例据此把当前 view 标脏、走真实的 guardedNav 判定。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { describe, it } from "node:test";
import { createRef } from "react";
import TestRenderer, {
  type ReactTestRenderer,
  type TestInstance,
} from "react-test-renderer";

register(new URL("./react-alias-hook.mjs", import.meta.url));
register(new URL("./settings-overlay-views-hook.mjs", import.meta.url));
const { act } = await import("react");
const { SettingsOverlay } = await import("@/layout/SettingsOverlay");
const { seenNavs } = await import("./settings-overlay-views-stub");
type Handle = import("@/layout/SettingsOverlay").SettingsOverlayHandle;
type Nav = import("@/features/settings/settings-nav").SettingsNavHandle;

type Mounted = {
  renderer: ReactTestRenderer;
  ref: ReturnType<typeof createRef<Handle>>;
  closeCount: () => number;
  restore: () => void;
};

async function mountOverlay(): Promise<Mounted> {
  const g = globalThis as unknown as {
    window?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  // 事件分发面：Overlay 用 window.addEventListener 注册技能面板跳转
  g.window = {addEventListener() {}, removeEventListener() {}};
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const closeCalls: number[] = [];
  const ref = createRef<Handle>();
  let renderer: ReactTestRenderer | undefined;
  seenNavs.clear();
  await act(async () => {
    renderer = TestRenderer.create(
      <SettingsOverlay
        ref={ref}
        open
        onClose={() => {
          closeCalls.push(1);
        }}
      />,
    );
  });
  return {
    renderer: renderer!,
    ref,
    closeCount: () => closeCalls.length,
    restore: () => {
      g.window = prevWindow;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    },
  };
}

function alertDialogCount(root: TestInstance): number {
  return root.findAll((n) => n.props["role"] === "alertdialog", {deep: true})
    .length;
}

async function clickCloseButton(root: TestInstance): Promise<void> {
  const btn = root.findAll(
    (n) => n.type === "button" && n.props["aria-label"] === "关闭设置",
    {deep: true},
  )[0];
  assert.ok(btn, "未找到关闭按钮");
  await act(async () => {
    (btn as unknown as {props: {onClick: () => void}}).props.onClick();
  });
}

/** 切到目标 view（经侧导航按钮，走真实的 guardedNav 分发点）。 */
async function gotoView(root: TestInstance, viewId: string): Promise<void> {
  const btn = root.findAll(
    (n) => n.type === "button" && n.props["data-settings-nav"] === viewId,
    {deep: true },
  )[0];
  assert.ok(btn, `未找到侧导航项 ${viewId}`);
  await act(async () => {
    (btn as unknown as {props: {onClick: () => void}}).props.onClick();
  });
}

describe("SettingsOverlay 关闭入口收归 handleClose (S-D-04)", () => {
  it("T-SD04-3 守卫放行时 requestClose 触发 onClose 一次、不弹确认", async () => {
    const mounted = await mountOverlay();
    try {
      assert.ok(mounted.ref.current, "句柄未挂上");
      await act(async () => {
        mounted.ref.current!.requestClose();
      });
      assert.equal(mounted.closeCount(), 1);
      assert.equal(alertDialogCount(mounted.renderer.root), 0);
    } finally {
      await act(async () => {
        mounted.renderer.unmount();
      });
      mounted.restore();
    }
  });

  it("T-SD04-3 当前 view 标脏时 requestClose 被守卫拦下：onClose 零次 + 确认弹窗可见", async () => {
    const mounted = await mountOverlay();
    try {
      // 切到智能体配置页（顶层页，关闭时会因 viewId 变化而卸载 ⇒ 过守卫）
      await gotoView(mounted.renderer.root, "agentsSettings");
      // 模拟该 view 上报 dirty（与 AgentEditorView/SkillDetailView 同一通道）
      const nav = seenNavs.get("agentsSettings") as Nav | undefined;
      assert.ok(nav, "未捕获到 view 的 nav 句柄");
      await act(async () => {
        nav.dirtyViews.add("agentsSettings");
      });

      assert.ok(mounted.ref.current, "句柄未挂上");
      await act(async () => {
        mounted.ref.current!.requestClose();
      });
      // 守卫拦下 ⇒ onClose 零次，且「未保存的更改」确认弹窗可见
      assert.equal(mounted.closeCount(), 0);
      assert.equal(alertDialogCount(mounted.renderer.root), 1);

      // 确认后落地：onClose 恰一次
      const confirm = mounted.renderer.root.findAll(
        (n) => n.type === "button" && n.props.children === "确定",
        {deep: true},
      )[0];
      assert.ok(confirm, "未找到确认按钮");
      await act(async () => {
        (confirm as unknown as {props: {onClick: () => void}}).props.onClick();
      });
      assert.equal(mounted.closeCount(), 1);
    } finally {
      await act(async () => {
        mounted.renderer.unmount();
      });
      mounted.restore();
    }
  });

  it("T-SD04-3 × 按钮与 requestClose 走同一条路径", async () => {
    const mounted = await mountOverlay();
    try {
      await clickCloseButton(mounted.renderer.root);
      assert.equal(mounted.closeCount(), 1);
      assert.equal(alertDialogCount(mounted.renderer.root), 0);
    } finally {
      await act(async () => {
        mounted.renderer.unmount();
      });
      mounted.restore();
    }
  });
});
