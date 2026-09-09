/**
 * WorkspaceHeaderActions 推送菜单（workspace-push spec T-WP7）：
 * - chat 面板且非子会话视图：菜单同时含「初始化」与「推送到项目工作区」；
 *   点推送菜单项后弹确认（danger 文案），确认才调 SESSIONS_PUSH_TEMPLATE，
 *   未确认（取消）不发起 IPC。
 * - 子会话视图（subagentSessionId != null）：推送与「初始化」整体隐藏
 *   （组件渲染 null，⋯ 菜单入口不可见）——覆盖类操作收敛到主会话。
 * - 非 chat 面板：无菜单（现状不变）。
 *
 * 与 fetch-models-modal.test.tsx 同范式：react-alias-hook 统一 react 副本，
 * react-test-renderer 真渲组件；ShellNavProvider 经 nav-hook 重定向到
 * stub（globalThis 注入导航状态）；IPC 拦在 window.novelMasterDesktop.invoke。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import TestRenderer, {
  type ReactTestRenderer,
  type ReactTestRendererRoot,
} from "react-test-renderer";

register(new URL("./react-alias-hook.mjs", import.meta.url));
register(new URL("./workspace-push-ui-hook.mjs", import.meta.url));
const { act } = await import("react");
const { WorkspaceHeaderActions } = await import(
  "@/features/workspace/WorkspaceHeaderActions"
);

/** 记录 IPC 调用（channel 维度）。 */
const invokeCalls: { channel: string; payload: unknown }[] = [];

function installGlobals(): () => void {
  const g = globalThis as unknown as {
    window?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  g.window = {
    novelMasterDesktop: {
      invoke: (channel: string, payload: unknown) => {
        invokeCalls.push({ channel, payload });
        return Promise.resolve({ ok: true, data: undefined });
      },
    },
  };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
    g.window = prevWindow;
    g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
  };
}

let restoreGlobals: (() => void) | undefined;

beforeEach(() => {
  invokeCalls.length = 0;
  restoreGlobals = installGlobals();
  globalThis.__workspacePushNavState = {
    workspaceSessionId: "s-1",
    subagentSessionId: undefined,
  };
});

afterEach(() => {
  restoreGlobals?.();
  restoreGlobals = undefined;
  globalThis.__workspacePushNavState = undefined;
});

/** 挂载组件（panelScope 可选）。 */
async function mount(panelScope = "chat"): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      <WorkspaceHeaderActions panelScope={panelScope} onRefresh={() => {}} />,
    );
  });
  if (renderer == null) {
    throw new Error("渲染失败");
  }
  return renderer;
}

/** 点开 ⋯ 更多菜单。 */
async function openMoreMenu(root: ReactTestRendererRoot): Promise<void> {
  await act(async () => {
    const more = root.findByProps({ "aria-label": "更多" });
    more.props.onClick({
      currentTarget: {
        getBoundingClientRect: () => ({ right: 100, bottom: 50 }),
      },
    });
  });
}

/** 按文案找菜单/弹窗里的按钮。 */
function findButtonByText(
  root: ReactTestRendererRoot,
  text: string,
): ReactTestRendererRoot {
  const btn = root
    .findAll(
      (node) =>
        typeof node.props.onClick === "function" &&
        (node.children as unknown[] | undefined)?.some(
          (c) => typeof c === "string" && c.includes(text),
        ),
    )
    .at(-1);
  assert.ok(btn != null, `未找到按钮：${text}`);
  return btn;
}

function buttonTexts(root: ReactTestRendererRoot): string[] {
  return root
    .findAll((node) => typeof node.props.onClick === "function")
    .map((node) =>
      (node.children as unknown[] | undefined)
        ?.filter((c): c is string => typeof c === "string")
        .join(""),
    )
    .filter(Boolean);
}

describe("WorkspaceHeaderActions 推送菜单（T-WP7）", () => {
  it("chat 面板且非子会话：菜单含「初始化」与「推送到项目工作区」", async () => {
    const renderer = await mount();
    await openMoreMenu(renderer.root);

    const texts = buttonTexts(renderer.root);
    assert.ok(
      texts.some((t) => t.includes("初始化")),
      "菜单应含「初始化」",
    );
    assert.ok(
      texts.some((t) => t.includes("推送到项目工作区")),
      "菜单应含「推送到项目工作区」",
    );
  });

  it("确认流：推送确认弹窗出现、文案明示覆盖母本；确认后才发 IPC", async () => {
    const renderer = await mount();
    await openMoreMenu(renderer.root);

    // 点推送菜单项 → 菜单关、ConfirmModal 出现（含 spec 确认文案）
    await act(async () => {
      findButtonByText(renderer.root, "推送到项目工作区").props.onClick();
    });
    const modalHtml = JSON.stringify(renderer.toJSON());
    assert.match(
      modalHtml,
      /将用当前聊天工作区覆盖项目工作区/,
      "确认文案应明示覆盖项目工作区",
    );
    assert.match(modalHtml, /模板母本/);
    // 确认前不发起 IPC
    assert.equal(invokeCalls.length, 0, "未确认不得发起推送");

    // 确认（danger 按钮）→ 发 SESSIONS_PUSH_TEMPLATE
    await act(async () => {
      findButtonByText(renderer.root, "确定").props.onClick();
    });
    assert.equal(invokeCalls.length, 1);
    assert.equal(invokeCalls[0]?.channel, "nm:sessions/pushTemplate");
    assert.deepEqual(invokeCalls[0]?.payload, { sessionId: "s-1" });
  });

  it("取消确认不发 IPC", async () => {
    const renderer = await mount();
    await openMoreMenu(renderer.root);
    await act(async () => {
      findButtonByText(renderer.root, "推送到项目工作区").props.onClick();
    });
    await act(async () => {
      findButtonByText(renderer.root, "取消").props.onClick();
    });
    assert.equal(invokeCalls.length, 0, "取消后不得发起推送");
  });

  it("子会话视图：推送与「初始化」均不可见（组件渲染 null）", async () => {
    globalThis.__workspacePushNavState = {
      workspaceSessionId: "s-1",
      subagentSessionId: "child-1",
    };
    const renderer = await mount();
    assert.equal(renderer.toJSON(), null, "子会话视图不渲染任何覆盖类入口");
  });

  it("非 chat 面板：无菜单（现状不变）", async () => {
    const renderer = await mount("session");
    assert.equal(renderer.toJSON(), null);
  });
});
