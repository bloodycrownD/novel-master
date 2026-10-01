/**
 * T-SD04-1/2 与 T-E-1..5：AgentEditorView 的 dirty 上报（S-D-04）与
 * 「模型列表加载失败时保留原绑定」（E）——同一屏、同一夹具、同一组期望，
 * 故合在一个文件里（RULE:85 第二条：同一份夹具只服务一套期望）。
 *
 * 两条锁的观测面：
 * - S-D-04：`nav.dirtyViews` 这个**注入 Set**（与生产同源、可注入）
 *   + 改字段前后的 has() 读数；
 * - E：`ipcAgentRegistryUpsert` 录下来的载荷的 `definition.model` 字段
 *   （不是「下拉显示成什么」这种可被形态绕开的弱观测）。
 *
 * 不用源码正则做主验收：把 effect 删掉、或把「找不到就传 null」改回去，
 * 行为用例都必须变红。
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
const { AgentEditorView } = await import(
  "@/features/settings/AgentEditorView"
);
type SettingsNavHandle = import("@/features/settings/settings-nav").SettingsNavHandle;

const CH_GET = "nm:agentRegistry/get";
const CH_UPSERT = "nm:agentRegistry/upsert";
const CH_PROVIDERS = "nm:providers/list";
const CH_SAVED_MODELS = "nm:providerModels/savedList";

/** 手写 nav fake：与生产同源（真的 Set），不做源码正则。 */
function makeNav(agentId: string): SettingsNavHandle {
  return {
    push: () => {},
    pop: () => {},
    navState: {editingAgentId: agentId},
    dirtyViews: new Set(),
    setAgentEditorTitle: () => {},
  } as unknown as SettingsNavHandle;
}

type UpsertCall = {definition: {model?: string}};

type Scenario = {
  readonly agentModel?: string;
  readonly providersOk: boolean;
  readonly savedModelsOk: boolean;
  readonly hasSavedModel: boolean;
};

/** 按场景构造各通道的应答（upsert 载荷由调用方另行录，见 mountEditor）。 */
function makeInvoke(scenario: Scenario): (channel: string) => Promise<unknown> {
  return async (channel: string): Promise<unknown> => {
    switch (channel) {
      case CH_GET:
        return {
          ok: true,
          data: {
            status: "ok",
            value: {
              name: "我的智能体",
              mode: "subagent",
              runtime: {maxSteps: 20},
              // definitionToForm 直读 def.prompts.system / .persist / .dynamic，
              // 缺这个对象会在首屏 applyDefinition 处抛错。
              prompts: {persist: [], dynamic: []},
              ...(scenario.agentModel != null ? {model: scenario.agentModel} : {}),
            },
            wire: null,
          },
        };
      case CH_PROVIDERS:
        return scenario.providersOk
          ? {ok: true, data: [{id: "prov1", displayName: "服务商一"}]}
          : {ok: false, error: {code: "X", message: "boom"}};
      case CH_SAVED_MODELS:
        return scenario.savedModelsOk
          ? {
              ok: true,
              data: scenario.hasSavedModel
                ? [{id: "m-pinned", vendorModelId: "vm1", displayName: "模型一"}]
                : [],
            }
          : {ok: false, error: {code: "X", message: "boom"}};
      default:
        return {ok: true, data: null};
    }
  };
}

async function mountEditor(
  scenario: Scenario,
): Promise<{
  renderer: ReactTestRenderer;
  nav: SettingsNavHandle;
  upserts: UpsertCall[];
  restore: () => void;
}> {
  const upserts: UpsertCall[] = [];
  const g = globalThis as unknown as {
    window?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  const channelReply = makeInvoke(scenario);
  g.window = {
    novelMasterDesktop: {
      invoke: async (channel: string, arg?: unknown) => {
        if (channel === CH_UPSERT) {
          upserts.push(arg as UpsertCall);
          return {ok: true};
        }
        return channelReply(channel);
      },
    },
  };
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const nav = makeNav("agent-1");
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(<AgentEditorView nav={nav} />);
  });
  // 首屏 loadAgent 的 promise 链 + passive effect 全部落定
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return {
    renderer: renderer!,
    nav,
    upserts,
    restore: () => {
      g.window = prevWindow;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    },
  };
}

/** 找 maxSteps 输入框（唯一 type=number）。 */
function findMaxSteps(root: TestInstance): TestInstance {
  const found = root.findAll(
    (n) => n.type === "input" && n.props.type === "number",
    {deep: true},
  )[0];
  assert.ok(found, "未找到 maxSteps 输入框");
  return found;
}

/** 找「专属模型」下拉：值为 UNRESOLVED 哨兵或空串/modelId 的那个 select。 */
function findModelSelect(root: TestInstance): TestInstance {
  const selects = root.findAll((n) => n.type === "select", {deep: true});
  assert.ok(selects.length >= 1, "未找到 select");
  // 「专属模型」是第二个 select（第一个是「作用域」）
  return selects[1] ?? selects[0]!;
}

async function setMaxSteps(root: TestInstance, value: string): Promise<void> {
  const input = findMaxSteps(root);
  await act(async () => {
    (input as unknown as {props: {onChange: (e: unknown) => void}}).props.onChange({
      target: {value},
    });
  });
  await act(async () => {});
}

async function clickSave(root: TestInstance): Promise<void> {
  const btn = root.findAll(
    (n) => n.type === "button" && n.props.children === "保存",
    {deep: true},
  )[0];
  assert.ok(btn, "未找到保存按钮");
  await act(async () => {
    (btn as unknown as {props: {onClick: () => void}}).props.onClick();
  });
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** 递归收集渲染树文本。 */
function textsOf(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (typeof node !== "object") return out;
  const kids = (node as {children?: unknown[]}).children;
  if (Array.isArray(kids)) {
    for (const k of kids) textsOf(k, out);
  }
  return out;
}

describe("AgentEditorView dirty 上报 (S-D-04)", () => {
  it("T-SD04-1 改字段后 agentEditor 上报 dirty、卸载后清除", async () => {
    const mounted = await mountEditor({
      providersOk: true,
      savedModelsOk: true,
      hasSavedModel: true,
    });
    try {
      // 加载完成、未改动时不标脏
      assert.equal(mounted.nav.dirtyViews.has("agentEditor"), false);
      await setMaxSteps(mounted.renderer.root, "25");
      assert.equal(mounted.nav.dirtyViews.has("agentEditor"), true);
      // 改回原值 ⇒ 重新不脏（持续同步，不是一次性置位）
      await setMaxSteps(mounted.renderer.root, "20");
      assert.equal(mounted.nav.dirtyViews.has("agentEditor"), false);
      await setMaxSteps(mounted.renderer.root, "25");
      assert.equal(mounted.nav.dirtyViews.has("agentEditor"), true);
      // 卸载清理：下次进入由首跑重新写入，不留死 view 的脏标记
      await act(async () => {
        mounted.renderer.unmount();
      });
      assert.equal(mounted.nav.dirtyViews.has("agentEditor"), false);
    } finally {
      mounted.restore();
    }
  });

  it("T-SD04-2 加载失败态不上报 dirty（那时页面上没有可编辑表单）", async () => {
    const upserts: UpsertCall[] = [];
    const g = globalThis as unknown as {window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean};
    const prevWindow = g.window;
    const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    g.window = {
      novelMasterDesktop: {
        invoke: async (channel: string) => {
          if (channel === CH_GET) {
            return {ok: false, error: {code: "X", message: "读取失败"}};
          }
          return {ok: true, data: null};
        },
      },
    };
    const nav = makeNav("agent-1");
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = TestRenderer.create(<AgentEditorView nav={nav} />);
      });
      for (let i = 0; i < 4; i++) {
        await act(async () => {
          await Promise.resolve();
        });
      }
      assert.equal(nav.dirtyViews.has("agentEditor"), false);
    } finally {
      await act(async () => {
        renderer?.unmount();
      });
      g.window = prevWindow;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      void upserts;
    }
  });
});

describe("AgentEditorView 模型绑定保留 (E)", () => {
  it("T-E-1 单服务商模型列表失败 → 保存仍保留原绑定 + 有提示", async () => {
    const mounted = await mountEditor({
      agentModel: "m-pinned",
      providersOk: true,
      savedModelsOk: false,
      hasSavedModel: false,
    });
    try {
      const hint = textsOf(mounted.renderer.toJSON()).join("");
      assert.ok(
        hint.includes("原绑定模型当前不可用"),
        `应渲染不可用提示，实际：${hint.slice(0, 400)}`,
      );
      await setMaxSteps(mounted.renderer.root, "25");
      await clickSave(mounted.renderer.root);
      assert.equal(mounted.upserts.length, 1);
      // 牙齿：改回「找不到就传 null」这里会变 undefined
      assert.equal(mounted.upserts[0]!.definition.model, "m-pinned");
    } finally {
      mounted.restore();
    }
  });

  it("T-E-2 ipcProvidersList 失败（最坏形态）→ 同上", async () => {
    const mounted = await mountEditor({
      agentModel: "m-pinned",
      providersOk: false,
      savedModelsOk: true,
      hasSavedModel: true,
    });
    try {
      const hint = textsOf(mounted.renderer.toJSON()).join("");
      assert.ok(hint.includes("原绑定模型当前不可用"));
      await setMaxSteps(mounted.renderer.root, "30");
      await clickSave(mounted.renderer.root);
      assert.equal(mounted.upserts[0]!.definition.model, "m-pinned");
    } finally {
      mounted.restore();
    }
  });

  it("T-E-3 出厂无绑定不误报：保存后 definition.model 仍为 undefined", async () => {
    const mounted = await mountEditor({
      providersOk: true,
      savedModelsOk: false,
      hasSavedModel: false,
    });
    try {
      const hint = textsOf(mounted.renderer.toJSON()).join("");
      assert.ok(
        !hint.includes("原绑定模型当前不可用"),
        "无绑定时不应渲染不可用提示",
      );
      await setMaxSteps(mounted.renderer.root, "31");
      await clickSave(mounted.renderer.root);
      assert.equal(mounted.upserts.length, 1);
      assert.equal(mounted.upserts[0]!.definition.model, undefined);
    } finally {
      mounted.restore();
    }
  });

  it("T-E-4 显式选回「默认(跟随)」可解除绑定（保留 ≠ 冻结）", async () => {
    const mounted = await mountEditor({
      agentModel: "m-pinned",
      providersOk: true,
      savedModelsOk: false,
      hasSavedModel: false,
    });
    try {
      const select = findModelSelect(mounted.renderer.root);
      await act(async () => {
        (select as unknown as {props: {onChange: (e: unknown) => void}}).props.onChange(
          {target: {value: ""}},
        );
      });
      await act(async () => {});
      await clickSave(mounted.renderer.root);
      assert.equal(mounted.upserts[0]!.definition.model, undefined);
    } finally {
      mounted.restore();
    }
  });

  it("T-E-5 成功路径：不渲染提示、载荷带原绑定、加载后未改动时 dirty=false", async () => {
    const mounted = await mountEditor({
      agentModel: "m-pinned",
      providersOk: true,
      savedModelsOk: true,
      hasSavedModel: true,
    });
    try {
      const hint = textsOf(mounted.renderer.toJSON()).join("");
      assert.ok(!hint.includes("原绑定模型当前不可用"));
      // 加载后未改动 ⇒ 快照与基线一致（core2 §9 B 的「打开即 dirty」同一条断言）
      assert.equal(mounted.nav.dirtyViews.has("agentEditor"), false);
      await setMaxSteps(mounted.renderer.root, "22");
      await clickSave(mounted.renderer.root);
      assert.equal(mounted.upserts[0]!.definition.model, "m-pinned");
    } finally {
      mounted.restore();
    }
  });
});
