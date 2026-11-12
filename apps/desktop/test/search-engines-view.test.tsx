/**
 * 搜索配置列表页 / 详情页（SPEC web-search-curl Step 6，T-U1/T-U2）：
 *
 * - T-U1 列表：动态行（六预置 + 自定义实例 + DDG，顺序 = DTO engines 顺序）、
 *   每行开关发 setEnabled、⋮ 菜单上移/下移提交**动态 id** 顺序、删除只对自定义
 *   引擎出现（确认后发 deleteCustomEngine）、「新建自定义引擎」进 Detail create
 *   模式（哨兵写入 navState）。
 * - T-U2 详情：预置分支的 baseUrl 回显（DTO engines 值）+ 恢复默认 + key 表单；
 *   模板表单平铺（SPEC v2 透传改造：高级编辑折叠与响应映射区已废除）；
 *   自定义分支的 headers JSON 非法 / defaultBody 非法 JSON → 不发保存 IPC、
 *   页内展示 validate 原因；密钥注入方式快捷选择写入 `{{apiKey}}` 头；
 *   key 表单随保存提交；测试按钮在途互斥（第二次点击不重复发 IPC）与
 *   preview 形态结果展示（JSON 预览 + 共 N 条 + 已截断）；create 模式的
 *   curl 导入预填（识别密钥、-d 预填 defaultBody）与解析失败整体拒绝
 *   （toast，表单不变）。
 *
 * CR 第 1 轮回归锁（cr-fix-spec 拍板 1/7）：预置已有覆盖且表单未改时测试请求
 * 不带 draft（表单改动仍带 draft）；预置零改动保存不发写 IPC 且 toast「无改动」、
 * needsKey 无 key 保存拦截；列表帮助弹窗五段与 mobile 真源同步（含密钥安全、
 * FIX-26 count 措辞）；测试失败错误经 SettingsStatus 错误红展示（FIX-27）。
 *
 * CR 第 2 轮回归锁：帮助弹窗 curl 导入句与 mobile 逐字同句（「，」标点定稿）；
 * 预置保存拦截改草稿判定（usesApiKey）——删掉 {{apiKey}} 引用且无已存 key 放行。
 *
 * 行为范式同 fetch-models-modal.test.tsx：react-alias-hook 统一 react 副本，
 * react-test-renderer 真渲组件，IPC 拦在 window.novelMasterDesktop.invoke；
 * ContextMenu 由 search-engines-ui-hook 换成去 portal 替身（node 无 DOM）。
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { afterEach, beforeEach, describe, it } from "node:test";
import TestRenderer, {
  type ReactTestRenderer,
  type TestInstance,
} from "react-test-renderer";
import type { ReactElement } from "react";
import { IPC_CHANNELS, type SearchConfigDto } from "@shared/ipc-types";
import type { CustomEngineDef } from "@shared/logic/search-engines";
import type {
  SettingsNavHandle,
  SettingsViewId,
} from "@/features/settings/settings-nav";

register(new URL("./react-alias-hook.mjs", import.meta.url));
register(new URL("./search-engines-ui-hook.mjs", import.meta.url));
const { act } = await import("react");
const { SearchEnginesView } = await import(
  "@/features/settings/SearchEnginesView"
);
const { SearchEngineDetailView } = await import(
  "@/features/settings/SearchEngineDetailView"
);
const { NEW_ENGINE_SENTINEL } = await import(
  "@/features/settings/search-engine-meta"
);
const { subscribeToast } = await import("@/components/ui/show-toast");

/** 自定义实例 fixture（id 形态照 core：`custom:{nanoid8}`；模板为 v2 透传形状，无映射字段）。 */
const CUSTOM_ENGINE: CustomEngineDef = {
  id: "custom:abc12345",
  name: "我的搜索",
  createdAt: "2026-11-01T00:00:00.000Z",
  template: {
    name: "我的搜索",
    method: "POST",
    url: "https://api.example.com/search",
    headers: { Authorization: "Bearer {{apiKey}}" },
    defaultBody: '{"query":"{{query}}"}',
    paramHint: "自定义实例",
  },
};

/** 配置读模型 fixture：四行覆盖 DDG / 预置 / 自定义混排与 baseUrl 回显。 */
function makeConfig(): SearchConfigDto {
  return {
    engines: [
      {
        id: "bocha",
        name: "博查搜索",
        enabled: true,
        needsKey: true,
        hasKey: true,
        needsBaseUrl: false,
        isCustom: false,
        paramHint: "",
      },
      {
        id: CUSTOM_ENGINE.id,
        name: CUSTOM_ENGINE.name,
        enabled: false,
        needsKey: true,
        hasKey: false,
        needsBaseUrl: false,
        isCustom: true,
        paramHint: "自定义实例",
      },
      {
        id: "duckduckgo",
        name: "DuckDuckGo",
        enabled: true,
        needsKey: false,
        hasKey: false,
        needsBaseUrl: false,
        isCustom: false,
        paramHint: "",
      },
      {
        id: "searxng",
        name: "SearXNG",
        enabled: false,
        needsKey: false,
        hasKey: false,
        needsBaseUrl: true,
        baseUrl: "https://searx.example.com",
        isCustom: false,
        paramHint: "",
      },
    ],
    customEngines: [CUSTOM_ENGINE],
    presetOverrides: { bocha: true },
    canRun: ["bocha", "duckduckgo"],
  };
}

type InvokeCall = { readonly channel: string; readonly payload: unknown };
type Invoke = (channel: string, payload: unknown) => Promise<unknown>;

/** 允许的 IPC 面：未知 channel 直接失败（防止 UI 打错通道被静默放过）。 */
const ALLOWED_CHANNELS = new Set<string>([
  IPC_CHANNELS.SEARCH_GET_CONFIG,
  IPC_CHANNELS.SEARCH_SAVE_ENGINE_KEY,
  IPC_CHANNELS.SEARCH_CLEAR_ENGINE_KEY,
  IPC_CHANNELS.SEARCH_SET_ENGINE_ORDER,
  IPC_CHANNELS.SEARCH_SET_ENABLED,
  IPC_CHANNELS.SEARCH_SET_ENGINE_BASE_URL,
  IPC_CHANNELS.SEARCH_CREATE_CUSTOM_ENGINE,
  IPC_CHANNELS.SEARCH_UPDATE_CUSTOM_ENGINE,
  IPC_CHANNELS.SEARCH_DELETE_CUSTOM_ENGINE,
  IPC_CHANNELS.SEARCH_UPDATE_PRESET_OVERRIDE,
  IPC_CHANNELS.SEARCH_RESET_PRESET_OVERRIDE,
  IPC_CHANNELS.SEARCH_TEST_ENGINE,
]);

/** 按 channel 路由的 IPC 假实现；testEngine 可注入挂起 promise 观察 busy 态。 */
function makeInvoke(
  config: SearchConfigDto,
  calls: InvokeCall[],
  testResponse?: () => Promise<unknown>,
): Invoke {
  return (channel, payload) => {
    calls.push({ channel, payload });
    if (!ALLOWED_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`测试未预期的 IPC channel: ${channel}`));
    }
    if (channel === IPC_CHANNELS.SEARCH_GET_CONFIG) {
      return Promise.resolve({ ok: true, data: config });
    }
    if (channel === IPC_CHANNELS.SEARCH_TEST_ENGINE) {
      return (
        testResponse ??
        (() => Promise.resolve({ ok: true, data: { preview: "[]", resultCount: 0, truncated: false } }))
      )();
    }
    return Promise.resolve({ ok: true, data: undefined });
  };
}

/** 挂全局 window.novelMasterDesktop，返回还原函数。 */
function mockWindow(invoke: Invoke): () => void {
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

/** 递归收集节点文本（host 节点 children 为字符串或嵌套节点）。 */
function textOf(node: TestInstance): string {
  let out = "";
  for (const child of node.children ?? []) {
    out += typeof child === "string" ? child : textOf(child);
  }
  return out;
}

function classNameOf(node: TestInstance): string {
  const value = node.props.className;
  return typeof value === "string" ? value : "";
}

function hasClass(node: TestInstance, className: string): boolean {
  return classNameOf(node).split(/\s+/).includes(className);
}

function findAllByClass(
  root: TestInstance,
  className: string,
): TestInstance[] {
  return root.findAll((node) => hasClass(node, className));
}

function findByClass(
  root: TestInstance,
  className: string,
): TestInstance | undefined {
  return findAllByClass(root, className).at(0);
}

function findButtonByText(
  root: TestInstance,
  text: string,
): TestInstance | undefined {
  return root
    .findAll((node) => node.type === "button" && textOf(node).trim() === text)
    .at(0);
}

function propString(node: TestInstance, name: string): string {
  const value = node.props[name];
  return typeof value === "string" ? value : "";
}

function propIsTrue(node: TestInstance, name: string): boolean {
  return node.props[name] === true;
}

function findByPlaceholder(
  root: TestInstance,
  placeholder: string,
): TestInstance | undefined {
  return root.findAll((node) => node.props.placeholder === placeholder).at(0);
}

/** 按 option 文案定位 select（method / 注入方式两个下拉各只有一个匹配项）。 */
function findSelectWithOption(
  root: TestInstance,
  optionText: string,
): TestInstance | undefined {
  return root
    .findAll(
      (node) =>
        node.type === "select" &&
        node
          .findAll(
            (child) =>
              child.type === "option" && textOf(child).includes(optionText),
          )
          .length > 0,
    )
    .at(0);
}

/** 调节点上的事件处理器（受控输入传 `{target:{value}}` / `{target:{checked}}`）。 */
function invokeProp(node: TestInstance, name: string, ...args: unknown[]): void {
  const handler = node.props[name];
  assert.equal(typeof handler, "function", `节点缺少 ${name} 处理器`);
  (handler as (...rest: unknown[]) => void)(...args);
}

/** 等一轮宏任务，让 act 内的 IPC promise 链与 setState 全部落定。 */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 挂载并等首轮读配置（effect → getConfig）落定。 */
async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  await settle();
  if (renderer == null) throw new Error("渲染失败");
  return renderer;
}

type NavFixture = {
  readonly handle: SettingsNavHandle;
  readonly pushes: SettingsViewId[];
  readonly pops: string[];
  readonly state: { editingEngineId?: string };
};

/** nav fixture：navState 为可变普通对象（Detail 页据此定位引擎 / 写哨兵）。 */
function makeNav(editingEngineId?: string): NavFixture {
  const pushes: SettingsViewId[] = [];
  const pops: string[] = [];
  const state: { editingEngineId?: string } = {
    ...(editingEngineId == null ? {} : { editingEngineId }),
  };
  return {
    handle: {
      push: (viewId) => {
        pushes.push(viewId);
      },
      pop: () => {
        pops.push("pop");
      },
      navState: state,
      dirtyViews: new Set(),
    },
    pushes,
    pops,
    state,
  };
}

function callsOf(calls: readonly InvokeCall[], channel: string): InvokeCall[] {
  return calls.filter((call) => call.channel === channel);
}

let restoreWindow: (() => void) | undefined;
let mounted: ReactTestRenderer[] = [];

beforeEach(() => {
  mounted = [];
});

afterEach(async () => {
  // 卸载也会触发 effect 清理与 setState，放进 act 内避免 act 警告
  await act(async () => {
    for (const renderer of mounted) renderer.unmount();
  });
  restoreWindow?.();
  restoreWindow = undefined;
});

async function mountWith(
  config: SearchConfigDto,
  element: (nav: NavFixture) => ReactElement,
  options: {
    readonly editingEngineId?: string;
    readonly calls?: InvokeCall[];
    readonly testResponse?: () => Promise<unknown>;
  } = {},
): Promise<{ renderer: ReactTestRenderer; nav: NavFixture; calls: InvokeCall[] }> {
  const calls = options.calls ?? [];
  restoreWindow = mockWindow(makeInvoke(config, calls, options.testResponse));
  const nav = makeNav(options.editingEngineId);
  const renderer = await mount(element(nav));
  mounted.push(renderer);
  return { renderer, nav, calls };
}

describe("T-U1 搜索配置列表页", () => {
  it("按 DTO engines 顺序动态渲染预置 / 自定义 / DDG 混排行与分类标签", async () => {
    const { renderer } = await mountWith(makeConfig(), (nav) => (
      <SearchEnginesView nav={nav.handle} />
    ));
    const rows = findAllByClass(renderer.root, "settings-list-item-row");
    assert.equal(rows.length, 4);
    const labels = rows.map((row) => {
      const label = findByClass(row, "settings-list-item__label");
      return label == null ? "" : textOf(label);
    });
    assert.ok(labels[0]?.includes("博查搜索"), `第 1 行应为预置 bocha：${labels[0]}`);
    assert.ok(labels[1]?.includes("我的搜索"), `第 2 行应为自定义实例：${labels[1]}`);
    assert.ok(labels[2]?.includes("DuckDuckGo"), `第 3 行应为 DDG：${labels[2]}`);
    assert.ok(labels[3]?.includes("SearXNG"), `第 4 行应为 searxng：${labels[3]}`);
    // 分类标签：自定义行有「自定义」，DDG 行有「内置」，预置行两者皆无
    assert.ok(textOf(rows[1] as TestInstance).includes("自定义"));
    assert.ok(textOf(rows[2] as TestInstance).includes("内置"));
    assert.ok(!textOf(rows[0] as TestInstance).includes("自定义"));
  });

  it("每行开关发 setEnabled（与行点击解耦；自定义 id 原样透传）", async () => {
    const { renderer, calls } = await mountWith(makeConfig(), (nav) => (
      <SearchEnginesView nav={nav.handle} />
    ));
    const toggle = renderer.root
      .findAll(
        (node) =>
          node.type === "input" && node.props["aria-label"] === "启用 我的搜索",
      )
      .at(0);
    assert.ok(toggle != null, "自定义行缺少启用开关");
    await act(async () => {
      invokeProp(toggle as TestInstance, "onChange", { target: { checked: true } });
    });
    await settle();
    const writes = callsOf(calls, IPC_CHANNELS.SEARCH_SET_ENABLED);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0]?.payload, {
      engineId: CUSTOM_ENGINE.id,
      enabled: true,
    });
  });

  it("⋮ 菜单上移 / 下移提交含自定义 id 的动态顺序", async () => {
    const { renderer, calls } = await mountWith(makeConfig(), (nav) => (
      <SearchEnginesView nav={nav.handle} />
    ));
    const openMenu = async (label: string): Promise<void> => {
      const button = renderer.root
        .findAll(
          (node) =>
            node.type === "button" && node.props["aria-label"] === label,
        )
        .at(0);
      assert.ok(button != null, `缺少菜单按钮：${label}`);
      await act(async () => {
        invokeProp(button as TestInstance, "onClick", {
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
          },
        });
      });
    };

    // DDG 上移一格：与自定义实例交换 → 提交序列里必须带 custom: id
    await openMenu("更多 DuckDuckGo");
    const up = findButtonByText(renderer.root, "上移");
    assert.ok(up != null, "菜单缺少上移项");
    await act(async () => {
      invokeProp(up as TestInstance, "onClick");
    });
    await settle();
    let writes = callsOf(calls, IPC_CHANNELS.SEARCH_SET_ENGINE_ORDER);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0]?.payload, {
      engineOrder: ["bocha", "duckduckgo", CUSTOM_ENGINE.id, "searxng"],
    });

    // 自定义实例下移一格：同样按动态 id 提交
    await openMenu("更多 我的搜索");
    const down = findButtonByText(renderer.root, "下移");
    assert.ok(down != null, "菜单缺少下移项");
    await act(async () => {
      invokeProp(down as TestInstance, "onClick");
    });
    await settle();
    writes = callsOf(calls, IPC_CHANNELS.SEARCH_SET_ENGINE_ORDER);
    assert.deepEqual(writes[1]?.payload, {
      engineOrder: ["bocha", "duckduckgo", CUSTOM_ENGINE.id, "searxng"],
    });
  });

  it("删除项只出现在自定义行，确认后发 deleteCustomEngine", async () => {
    const { renderer, calls } = await mountWith(makeConfig(), (nav) => (
      <SearchEnginesView nav={nav.handle} />
    ));
    const openMenu = async (label: string): Promise<void> => {
      const button = renderer.root
        .findAll(
          (node) =>
            node.type === "button" && node.props["aria-label"] === label,
        )
        .at(0);
      assert.ok(button != null, `缺少菜单按钮：${label}`);
      await act(async () => {
        invokeProp(button as TestInstance, "onClick", {
          currentTarget: {
            getBoundingClientRect: () => ({ left: 0, bottom: 0 }),
          },
        });
      });
    };

    // 预置行：菜单无删除项（此时菜单只有上移/下移）
    await openMenu("更多 博查搜索");
    assert.equal(findButtonByText(renderer.root, "删除"), undefined);

    // 自定义行：删除 → 确认弹窗 → 发 IPC（菜单单例，重开即替换）
    await openMenu("更多 我的搜索");
    const remove = findButtonByText(renderer.root, "删除");
    assert.ok(remove != null, "自定义行菜单缺少删除项");
    await act(async () => {
      invokeProp(remove as TestInstance, "onClick");
    });
    const confirm = findByClass(renderer.root, "confirm-modal");
    assert.ok(confirm != null, "删除未弹确认框");
    const confirmButton = findButtonByText(confirm as TestInstance, "删除");
    assert.ok(confirmButton != null, "确认框缺少删除按钮");
    await act(async () => {
      invokeProp(confirmButton as TestInstance, "onClick");
    });
    await settle();
    const deletes = callsOf(calls, IPC_CHANNELS.SEARCH_DELETE_CUSTOM_ENGINE);
    assert.equal(deletes.length, 1);
    assert.deepEqual(deletes[0]?.payload, { engineId: CUSTOM_ENGINE.id });
  });

  it("新建入口写哨兵并推 searchEngineDetail（复用 viewId 的 create 模式）", async () => {
    const { renderer, nav } = await mountWith(makeConfig(), (fixture) => (
      <SearchEnginesView nav={fixture.handle} />
    ));
    const createButton = findButtonByText(renderer.root, "新建自定义引擎");
    assert.ok(createButton != null, "缺少新建入口");
    await act(async () => {
      invokeProp(createButton as TestInstance, "onClick");
    });
    assert.deepEqual(nav.pushes, ["searchEngineDetail"]);
    assert.equal(nav.state.editingEngineId, NEW_ENGINE_SENTINEL);
  });

  it("帮助弹窗五段与 mobile 真源同步（含密钥安全与 FIX-26 count 措辞）", async () => {
    const { renderer } = await mountWith(makeConfig(), (nav) => (
      <SearchEnginesView nav={nav.handle} />
    ));
    const helpButton = renderer.root
      .findAll(
        (node) =>
          node.type === "button" && node.props["aria-label"] === "使用说明",
      )
      .at(0);
    assert.ok(helpButton != null, "缺少帮助按钮");
    await act(async () => {
      invokeProp(helpButton as TestInstance, "onClick");
    });
    const modal = findByClass(renderer.root, "text-prompt-modal");
    assert.ok(modal != null, "帮助弹窗未打开");
    const modalText = textOf(modal as TestInstance);
    for (const section of ["启用开关", "引擎优先级", "模板与自定义引擎", "测试消耗配额", "密钥安全"]) {
      assert.ok(modalText.includes(section), `帮助弹窗缺少「${section}」段`);
    }
    assert.ok(
      modalText.includes('整数字段写 "{{count}}"（带引号）'),
      `count 措辞应为 FIX-26 定稿：${modalText}`,
    );
    // SPEC v2：响应映射措辞删除，curl 导入 / defaultBody 可选口径保留
    assert.ok(!modalText.includes("结果映射") && !modalText.includes("高级区"), `响应映射措辞应已删除：${modalText}`);
    assert.ok(
      modalText.includes("粘贴 curl 命令导入，用模板描述任意搜索 API"),
      `curl 导入句应与 mobile 真源逐字同句（CR2 标点定稿）：${modalText}`,
    );
    assert.ok(modalText.includes("请求体 defaultBody 可选"), `应保留 defaultBody 可选口径：${modalText}`);
  });
});

describe("T-U2 搜索引擎详情页", () => {
  it("预置 searxng：baseUrl 回显 + 无 key 表单 + 模板表单平铺（高级编辑折叠已废除）", async () => {
    const { renderer, calls } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: "searxng" },
    );
    const baseUrlInput = findByPlaceholder(
      renderer.root,
      "https://searxng.example.com",
    );
    assert.ok(baseUrlInput != null, "缺少实例地址表单");
    assert.equal(propString(baseUrlInput as TestInstance, "value"), "https://searx.example.com");
    assert.equal(
      renderer.root.findAll(
        (node) => node.type === "input" && node.props.type === "password",
      ).length,
      0,
    );
    // 无覆盖（presetOverrides 只有 bocha）→ 不显示恢复默认
    assert.equal(findButtonByText(renderer.root, "恢复默认"), undefined);
    // 高级编辑折叠容器已废除：模板表单直接平铺（method 下拉 + URL 输入无需展开）
    assert.equal(findButtonByText(renderer.root, "高级编辑"), undefined);
    const methodSelect = findSelectWithOption(renderer.root, "POST");
    assert.ok(methodSelect != null, "模板表单应平铺出 method 下拉");
    const urlInput = findByPlaceholder(
      renderer.root,
      "https://api.example.com/search?q={{query}}",
    );
    assert.ok(urlInput != null, "缺少 URL 表单");
    assert.ok(
      propString(urlInput as TestInstance, "value").includes("{{baseUrl}}"),
      "searxng 模板 URL 应引用 {{baseUrl}}",
    );
    // 响应映射区已废除：无结果数组路径 / 字段候选控件
    assert.equal(findByPlaceholder(renderer.root, "results"), undefined);
    // 未有写操作
    assert.equal(
      calls.filter((call) => call.channel !== IPC_CHANNELS.SEARCH_GET_CONFIG)
        .length,
      0,
    );
  });

  it("预置 bocha：有覆盖时显示恢复默认，key 表单保存走 saveEngineKey", async () => {
    const { renderer, calls } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: "bocha" },
    );
    const reset = findButtonByText(renderer.root, "恢复默认");
    assert.ok(reset != null, "已有覆盖时缺少恢复默认");
    await act(async () => {
      invokeProp(reset as TestInstance, "onClick");
    });
    await settle();
    assert.deepEqual(
      callsOf(calls, IPC_CHANNELS.SEARCH_RESET_PRESET_OVERRIDE)[0]?.payload,
      { engineId: "bocha" },
    );

    const keyInput = renderer.root
      .findAll(
        (node) => node.type === "input" && node.props.type === "password",
      )
      .at(0);
    assert.ok(keyInput != null, "需 key 模板缺少 key 表单");
    await act(async () => {
      invokeProp(keyInput as TestInstance, "onChange", {
        target: { value: "sk-bocha-123456" },
      });
    });
    const save = findButtonByText(renderer.root, "保存");
    assert.ok(save != null, "缺少保存按钮");
    await act(async () => {
      invokeProp(save as TestInstance, "onClick");
    });
    await settle();
    assert.deepEqual(callsOf(calls, IPC_CHANNELS.SEARCH_SAVE_ENGINE_KEY)[0]?.payload, {
      engineId: "bocha",
      apiKey: "sk-bocha-123456",
    });
    // 模板未改动 → 不写覆盖
    assert.equal(callsOf(calls, IPC_CHANNELS.SEARCH_UPDATE_PRESET_OVERRIDE).length, 0);
  });

  it("拍板 7：预置零改动保存不发写 IPC 且 toast「无改动」", async () => {
    const toasts: string[] = [];
    const unsubscribe = subscribeToast((state) => {
      if (state != null) toasts.push(state.message);
    });
    try {
      // bocha 已存 key（hasKey=true，不触发拦截）；表单未改 + key 草稿空 → 零写操作
      const { renderer, calls } = await mountWith(
        makeConfig(),
        (nav) => <SearchEngineDetailView nav={nav.handle} />,
        { editingEngineId: "bocha" },
      );
      const save = findButtonByText(renderer.root, "保存");
      assert.ok(save != null, "缺少保存按钮");
      await act(async () => {
        invokeProp(save as TestInstance, "onClick");
      });
      await settle();
      const writes = calls.filter((call) => call.channel !== IPC_CHANNELS.SEARCH_GET_CONFIG);
      assert.equal(writes.length, 0, `零改动不应发写 IPC：${JSON.stringify(writes)}`);
      assert.ok(toasts.includes("无改动"), `应 toast「无改动」：${toasts.join(" / ")}`);
    } finally {
      unsubscribe();
    }
  });

  it("拍板 7：预置需 key 且无已存 key、key 草稿空时保存拦截", async () => {
    // bocha needsKey 且未存 key（engines 只读，重建首行变体而非原地改）
    const base = makeConfig();
    const config: SearchConfigDto = {
      ...base,
      engines: base.engines.map((engine, index) =>
        index === 0 ? { ...engine, hasKey: false } : engine,
      ),
    };
    const { renderer, calls } = await mountWith(
      config,
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: "bocha" },
    );
    const save = findButtonByText(renderer.root, "保存");
    assert.ok(save != null, "缺少保存按钮");
    await act(async () => {
      invokeProp(save as TestInstance, "onClick");
    });
    await settle();
    assert.equal(callsOf(calls, IPC_CHANNELS.SEARCH_SAVE_ENGINE_KEY).length, 0);
    assert.equal(callsOf(calls, IPC_CHANNELS.SEARCH_UPDATE_PRESET_OVERRIDE).length, 0);
    const status = findByClass(renderer.root, "settings-status");
    assert.ok(status != null, "缺少拦截提示");
    const message = textOf(status as TestInstance);
    assert.ok(message.includes("请输入 API Key"), `拦截文案应与 mobile 一致：${message}`);
  });

  it("CR2 P2-9：预置改模板删掉 {{apiKey}} 引用且无已存 key → 保存放行（拦截按草稿判定）", async () => {
    // bocha needsKey 且未存 key；草稿把 Authorization 头删掉后模板不再引用
    // {{apiKey}}（url/defaultBody 本就不含）——拦截若仍按已存 engine.needsKey
    // 判定会误拦，按草稿 usesApiKey 判定则放行并提交 headers 覆盖。
    const base = makeConfig();
    const config: SearchConfigDto = {
      ...base,
      engines: base.engines.map((engine, index) =>
        index === 0 ? { ...engine, hasKey: false } : engine,
      ),
    };
    const { renderer, calls } = await mountWith(
      config,
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: "bocha" },
    );
    const headers = findByPlaceholder(
      renderer.root,
      '{"Authorization": "Bearer {{apiKey}}"}',
    );
    assert.ok(headers != null, "缺少 Headers 文本域");
    await act(async () => {
      invokeProp(headers as TestInstance, "onChange", {
        target: { value: '{"Content-Type": "application/json"}' },
      });
    });
    const save = findButtonByText(renderer.root, "保存");
    assert.ok(save != null, "缺少保存按钮");
    await act(async () => {
      invokeProp(save as TestInstance, "onClick");
    });
    await settle();
    const updates = callsOf(calls, IPC_CHANNELS.SEARCH_UPDATE_PRESET_OVERRIDE);
    assert.equal(
      updates.length,
      1,
      `草稿已无 key 引用应放行保存：${JSON.stringify(calls)}`,
    );
    const payload = updates[0]?.payload as {
      engineId: string;
      patch: { headers: Record<string, string> };
    };
    assert.equal(payload.engineId, "bocha");
    assert.deepEqual(payload.patch.headers, {
      "Content-Type": "application/json",
    });
    const status = findByClass(renderer.root, "settings-status");
    const message = status == null ? "" : textOf(status as TestInstance);
    assert.ok(
      !message.includes("请输入 API Key"),
      `草稿无 key 引用不应拦截：${message}`,
    );
  });

  it("自定义引擎：headers JSON 非法时拒绝保存并页内展示原因", async () => {
    const { renderer, calls } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: CUSTOM_ENGINE.id },
    );
    const headers = findByPlaceholder(
      renderer.root,
      '{"Authorization": "Bearer {{apiKey}}"}',
    );
    assert.ok(headers != null, "缺少 Headers 文本域");
    await act(async () => {
      invokeProp(headers as TestInstance, "onChange", {
        target: { value: "{ not json" },
      });
    });
    const save = findButtonByText(renderer.root, "保存");
    assert.ok(save != null, "缺少保存按钮");
    await act(async () => {
      invokeProp(save as TestInstance, "onClick");
    });
    await settle();
    assert.equal(callsOf(calls, IPC_CHANNELS.SEARCH_UPDATE_CUSTOM_ENGINE).length, 0);
    const status = findByClass(renderer.root, "settings-status");
    assert.ok(status != null, "缺少错误展示");
    const message = textOf(status as TestInstance);
    assert.ok(message.includes("搜索模板无效"), `错误文案应走 catalog：${message}`);
    assert.ok(message.includes("Headers 必须是合法 JSON"), `原因应可读：${message}`);
  });

  it("自定义引擎：core 模板校验失败（defaultBody 非法 JSON）经 catalog 展示原因、不发保存 IPC", async () => {
    const { renderer, calls } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: CUSTOM_ENGINE.id },
    );
    // fixture 的 defaultBody 为合法 JSON：改坏后 validate 失败（v2 唯一的 JSON 体校验入口）。
    const defaultBody = findByPlaceholder(
      renderer.root,
      '{"query": "{{query}}", "count": "{{count}}"}',
    );
    assert.ok(defaultBody != null, "缺少请求体模板文本域");
    await act(async () => {
      invokeProp(defaultBody as TestInstance, "onChange", {
        target: { value: "{ not json" },
      });
    });
    const save = findButtonByText(renderer.root, "保存");
    assert.ok(save != null, "缺少保存按钮");
    await act(async () => {
      invokeProp(save as TestInstance, "onClick");
    });
    await settle();
    assert.equal(callsOf(calls, IPC_CHANNELS.SEARCH_UPDATE_CUSTOM_ENGINE).length, 0);
    const status = findByClass(renderer.root, "settings-status");
    assert.ok(status != null, "缺少错误展示");
    const message = textOf(status as TestInstance);
    // 错误 descriptor 由 core 携带 messageKey/params，UI 经 coreT 译出原因。
    assert.ok(message.includes("搜索模板无效"), `错误文案应走 catalog：${message}`);
    assert.ok(message.includes("defaultBody"), `原因应可读：${message}`);
  });

  it("自定义引擎：注入方式快捷选择写 {{apiKey}} 头，保存提交模板与 key", async () => {
    const { renderer, calls } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: CUSTOM_ENGINE.id },
    );
    const injection = findSelectWithOption(renderer.root, "X-API-Key: {{apiKey}}");
    assert.ok(injection != null, "缺少注入方式下拉");
    await act(async () => {
      invokeProp(injection as TestInstance, "onChange", {
        target: { value: "X-API-Key: {{apiKey}}" },
      });
    });
    const headers = findByPlaceholder(
      renderer.root,
      '{"Authorization": "Bearer {{apiKey}}"}',
    );
    assert.ok(headers != null, "缺少 Headers 文本域");
    const headersText = propString(headers as TestInstance, "value");
    assert.ok(
      headersText.includes('"X-API-Key": "{{apiKey}}"'),
      `注入方式未写入 Headers：${headersText}`,
    );

    const keyInput = renderer.root
      .findAll(
        (node) => node.type === "input" && node.props.type === "password",
      )
      .at(0);
    assert.ok(keyInput != null, "缺少 key 表单");
    await act(async () => {
      invokeProp(keyInput as TestInstance, "onChange", {
        target: { value: "sk-custom-1234567890" },
      });
    });
    const save = findButtonByText(renderer.root, "保存");
    assert.ok(save != null, "缺少保存按钮");
    await act(async () => {
      invokeProp(save as TestInstance, "onClick");
    });
    await settle();
    const updates = callsOf(calls, IPC_CHANNELS.SEARCH_UPDATE_CUSTOM_ENGINE);
    assert.equal(updates.length, 1);
    const payload = updates[0]?.payload as {
      engineId: string;
      apiKey?: string;
      template: { headers: Record<string, string>; url: string };
    };
    assert.equal(payload.engineId, CUSTOM_ENGINE.id);
    assert.equal(payload.apiKey, "sk-custom-1234567890");
    assert.equal(payload.template.headers["X-API-Key"], "{{apiKey}}");
    assert.equal(payload.template.url, CUSTOM_ENGINE.template.url);
  });

  it("测试按钮在途互斥（不重复发 IPC）并展示 preview 预览结果", async () => {
    let resolveTest: ((value: unknown) => void) | undefined;
    const pending = new Promise<unknown>((resolve) => {
      resolveTest = resolve;
    });
    const { renderer, calls } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      {
        editingEngineId: CUSTOM_ENGINE.id,
        testResponse: () => pending,
      },
    );
    const queryInput = findByPlaceholder(renderer.root, "例如：人工智能");
    assert.ok(queryInput != null, "缺少测试查询输入");
    await act(async () => {
      invokeProp(queryInput as TestInstance, "onChange", {
        target: { value: "人工智能" },
      });
    });
    const testButton = findButtonByText(renderer.root, "测试");
    assert.ok(testButton != null, "缺少测试按钮");
    await act(async () => {
      invokeProp(testButton as TestInstance, "onClick");
    });
    const busyButton = findButtonByText(renderer.root, "测试中…");
    assert.ok(busyButton != null, "在途时按钮应显示「测试中…」");
    assert.equal(propIsTrue(busyButton as TestInstance, "disabled"), true);
    // 在途再点一次：早退守卫挡住，不重复发 IPC
    await act(async () => {
      invokeProp(busyButton as TestInstance, "onClick");
    });
    assert.equal(callsOf(calls, IPC_CHANNELS.SEARCH_TEST_ENGINE).length, 1);

    resolveTest?.({
      ok: true,
      data: {
        preview: '[{"title":"结果甲","url":"https://a.example.com"}]',
        resultCount: 7,
        truncated: true,
      },
    });
    await settle();
    const status = findAllByClass(renderer.root, "settings-hint")
      .map(textOf)
      .join("\n");
    // SPEC v2 §5：测试结果渲染 JSON 预览文本 + 「共 N 条」+ 截断标记，不再渲染标题列表
    assert.ok(status.includes('[{"title":"结果甲"'), `缺少 JSON 预览文本：${status}`);
    assert.ok(status.includes("共 7 条"), `缺少结果计数：${status}`);
    assert.ok(status.includes("已截断"), `缺少截断标记：${status}`);

    const payload = callsOf(calls, IPC_CHANNELS.SEARCH_TEST_ENGINE)[0]
      ?.payload as {
      engineId?: string;
      query: string;
      draft?: { template?: { url?: string } };
    };
    assert.equal(payload.engineId, CUSTOM_ENGINE.id);
    assert.equal(payload.query, "人工智能");
    assert.equal(payload.draft?.template?.url, CUSTOM_ENGINE.template.url);
  });

  it("拍板 1：预置已有覆盖且表单未改时测试只传 engineId（不带 draft）", async () => {
    // bocha 有覆盖（presetOverrides.bocha = true），表单加载出厂模板原样 →
    // 测试应交给 core 走覆盖合并 + SKSP 现读，而非测出厂模板
    const { renderer, calls } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: "bocha" },
    );
    const queryInput = findByPlaceholder(renderer.root, "例如：人工智能");
    assert.ok(queryInput != null, "缺少测试查询输入");
    await act(async () => {
      invokeProp(queryInput as TestInstance, "onChange", {
        target: { value: "人工智能" },
      });
    });
    const testButton = findButtonByText(renderer.root, "测试");
    assert.ok(testButton != null, "缺少测试按钮");
    await act(async () => {
      invokeProp(testButton as TestInstance, "onClick");
    });
    await settle();
    const payloads = callsOf(calls, IPC_CHANNELS.SEARCH_TEST_ENGINE);
    assert.equal(payloads.length, 1);
    const payload = payloads[0]?.payload as { engineId?: string; draft?: unknown };
    assert.equal(payload.engineId, "bocha");
    assert.equal(payload.draft, undefined, `表单未改不应带 draft：${JSON.stringify(payload)}`);
  });

  it("拍板 1：预置表单有改动时测试仍带 draft（草稿直测不变）", async () => {
    const { renderer, calls } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      { editingEngineId: "bocha" },
    );
    // 模板表单已平铺：直接改 URL 即构成表单改动
    const urlInput = findByPlaceholder(
      renderer.root,
      "https://api.example.com/search?q={{query}}",
    );
    assert.ok(urlInput != null, "缺少 URL 表单");
    await act(async () => {
      invokeProp(urlInput as TestInstance, "onChange", {
        target: { value: "https://api.bochaai.com/v1/web-search-v2" },
      });
    });
    const queryInput = findByPlaceholder(renderer.root, "例如：人工智能");
    await act(async () => {
      invokeProp(queryInput as TestInstance, "onChange", {
        target: { value: "人工智能" },
      });
    });
    const testButton = findButtonByText(renderer.root, "测试");
    await act(async () => {
      invokeProp(testButton as TestInstance, "onClick");
    });
    await settle();
    const payload = callsOf(calls, IPC_CHANNELS.SEARCH_TEST_ENGINE)[0]
      ?.payload as {
      engineId?: string;
      draft?: { template?: { url?: string } };
    };
    assert.equal(payload.engineId, "bocha");
    assert.equal(
      payload.draft?.template?.url,
      "https://api.bochaai.com/v1/web-search-v2",
      `表单有改动应带 draft：${JSON.stringify(payload)}`,
    );
  });

  it("测试失败：错误经 SettingsStatus 错误红展示（FIX-27）", async () => {
    const { renderer } = await mountWith(
      makeConfig(),
      (nav) => <SearchEngineDetailView nav={nav.handle} />,
      {
        editingEngineId: CUSTOM_ENGINE.id,
        testResponse: () =>
          Promise.resolve({
            ok: false,
            error: { code: "TOOL_SEARCH_ENGINE_FAILED", message: "引擎不可用（测试桩）" },
          }),
      },
    );
    const queryInput = findByPlaceholder(renderer.root, "例如：人工智能");
    await act(async () => {
      invokeProp(queryInput as TestInstance, "onChange", {
        target: { value: "人工智能" },
      });
    });
    const testButton = findButtonByText(renderer.root, "测试");
    await act(async () => {
      invokeProp(testButton as TestInstance, "onClick");
    });
    await settle();
    const status = findByClass(renderer.root, "settings-status");
    assert.ok(status != null, "缺少错误展示");
    assert.ok(textOf(status as TestInstance).includes("引擎不可用"));
    const style = (status as TestInstance).props.style as
      | { color?: string }
      | undefined;
    assert.ok(
      typeof style?.color === "string" && style.color.includes("--danger"),
      `测试失败错误应为错误红（var(--danger)）：${String(style?.color)}`,
    );
  });

  it("create 模式：curl 导入预填（识别密钥），解析失败整体拒绝且表单不变", async () => {
    const toasts: string[] = [];
    const unsubscribe = subscribeToast((state) => {
      if (state != null) toasts.push(state.message);
    });
    try {
      const { renderer } = await mountWith(
        makeConfig(),
        (nav) => <SearchEngineDetailView nav={nav.handle} />,
        { editingEngineId: NEW_ENGINE_SENTINEL },
      );
      // create 模式不读库：只出现 curl 导入 + 表单
      const curlInput = findByPlaceholder(
        renderer.root,
        'curl -X POST https://api.example.com/search -H \'Authorization: Bearer sk-xxx\' -d \'{"query":"{{query}}"}\'',
      );
      assert.ok(curlInput != null, "create 模式缺少 curl 粘贴域");
      await act(async () => {
        invokeProp(curlInput as TestInstance, "onChange", {
          target: {
            value:
              'curl -X POST https://api.example.com/search -H "Authorization: Bearer sk-abcdef123456789012" -d \'{"query":"{{query}}"}\'',
          },
        });
      });
      const parseButton = findButtonByText(renderer.root, "解析并预填");
      assert.ok(parseButton != null, "缺少解析按钮");
      await act(async () => {
        invokeProp(parseButton as TestInstance, "onClick");
      });

      const urlInput = findByPlaceholder(
        renderer.root,
        "https://api.example.com/search?q={{query}}",
      );
      assert.ok(urlInput != null, "缺少 URL 表单");
      assert.equal(
        propString(urlInput as TestInstance, "value"),
        "https://api.example.com/search",
      );
      const methodSelect = findSelectWithOption(renderer.root, "POST");
      assert.equal(propString(methodSelect as TestInstance, "value"), "POST");
      const headers = findByPlaceholder(
        renderer.root,
        '{"Authorization": "Bearer {{apiKey}}"}',
      );
      assert.ok(headers != null, "缺少 Headers 文本域");
      assert.ok(
        propString(headers as TestInstance, "value").includes(
          "Bearer {{apiKey}}",
        ),
        "curl 中的明文密钥应替换为 {{apiKey}}",
      );
      // SPEC v2：-d 原文预填 defaultBody（不再预填任何响应映射字段）
      const defaultBody = findByPlaceholder(
        renderer.root,
        '{"query": "{{query}}", "count": "{{count}}"}',
      );
      assert.ok(defaultBody != null, "缺少请求体模板文本域");
      assert.equal(
        propString(defaultBody as TestInstance, "value"),
        '{"query":"{{query}}"}',
        "curl -d 应预填请求体模板 defaultBody",
      );
      const keyInput = renderer.root
        .findAll(
          (node) => node.type === "input" && node.props.type === "password",
        )
        .at(0);
      assert.equal(
        propString(keyInput as TestInstance, "value"),
        "sk-abcdef123456789012",
      );
      assert.ok(
        renderer.root.findAll(
          (node) =>
            hasClass(node, "settings-hint") &&
            textOf(node).includes("已识别到密钥"),
        ).length > 0,
        "缺少密钥识别提示",
      );

      // 解析失败：整体拒绝（toast 原因），表单保持上次成功导入的值
      await act(async () => {
        invokeProp(curlInput as TestInstance, "onChange", {
          target: { value: "wget https://api.example.com/search" },
        });
      });
      await act(async () => {
        invokeProp(parseButton as TestInstance, "onClick");
      });
      assert.ok(
        toasts.some((message) => message.includes("curl 命令解析失败")),
        `解析失败应整条拒绝并 toast 原因：${toasts.join(" / ")}`,
      );
      assert.equal(
        propString(urlInput as TestInstance, "value"),
        "https://api.example.com/search",
      );
    } finally {
      unsubscribe();
    }
  });
});
