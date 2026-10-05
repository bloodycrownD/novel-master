/**
 * T-R6 / T-DP1~T-DP5：desktop 提示词查看「三层结构」UI（prompt-preview-ui-redesign Step6）。
 *
 * 覆盖：
 * - 轮卡列表：轮统一形态（role 徽标 + summaryText 单行截断 + metaText 行），
 *   点头部就地展开/收起（展开区渲染 `turn.cards`）；
 * - 展开区的叶子卡（text / thinking，限 6 行预览）与工具组卡
 *   （组头状态点三态 + 可选「并行」徽标 + use/result 两格，悬挂时「未返回结果」占位）；
 * - 全屏 Modal：正文容器 `.prompt-fullscreen__body` 内挂 pre 原文（用户拍板只保留
 *   原文档，渲染管线退役）；Esc（defaultPrevented 不拦截）/ 遮罩 / footer 三条关闭路径；
 * - 退役字段（`body` / `items`）即便残留在 payload 里也不参与渲染。
 *
 * 范式对齐 fetch-models-modal.test.tsx / metrics-detail-popover.test.tsx：
 * react-alias-hook.mjs 统一根 react 副本，react-test-renderer 真渲面板；
 * IPC 拦在 window.novelMasterDesktop.invoke（ipc client 底层出口）。
 * node 环境无 document，Modal 的 Esc 监听用最小 document 桩驱动。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { PromptPreviewTurnDto } from "@shared/ipc-types";
import TestRenderer, {
  type ReactTestRenderer,
  type ReactTestRendererRoot,
} from "react-test-renderer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(__dirname, "..", "renderer");
const desktopRoot = join(__dirname, "..");

register(new URL("./react-alias-hook.mjs", import.meta.url));
const { act } = await import("react");
const { RealPromptPanel } = await import("@/features/chat/RealPromptPanel");

/**
 * 三类轮各一条 + 一个组卡（ok 态），与 core `buildPromptPreviewTurnsFromLayout`
 * 的 payload 形态对齐：`cards` 是唯一正文载体，`body` / `items` / `summary` 均已退役。
 *
 * 轮卡默认**收起**，所以 cards 里的正文默认不出现在 DOM 里——这正是 T-DP1 要钉的
 * 「摘要单行 + 就地展开」行为基线。
 */
const TURNS: PromptPreviewTurnDto[] = [
  {
    id: "seg-sys",
    kind: "system",
    summaryText: "system",
    metaText: "6 字",
    cards: [
      // system 轮（system 段）的卡片 id 沿用段 id（core 侧同口径）。
      { type: "text", id: "seg-sys", role: "system", body: "你是写作助手。" },
    ],
  },
  {
    // workplace 轮（kkv 快照源头直通的文件级组卡）。
    id: "prompt-workplace",
    kind: "user",
    summaryText: "workplace",
    metaText: "28 字",
    cards: [
      {
        type: "workplace",
        id: "prompt-workplace",
        files: [
          { path: "outline/大纲.md", display: "full", body: "1|第一行\n2|第二行" },
          { path: "notes/草稿.txt", display: "filename", body: "1|草稿.txt" },
        ],
      },
    ],
  },
  {
    id: "turn-5",
    kind: "user",
    summaryText: "帮我写第一章",
    metaText: "#5 · 15 字",
    cards: [
      // ⚠️ user 轮两张卡是**合成夹具**：core 实为「wrap 后整条文本直转单卡」，
      // 这里造第二张卡只为覆盖叶子卡多张时展开区的连续渲染。
      { type: "text", id: "card-u1", role: "user", body: "帮我写第一章" },
      { type: "text", id: "card-u2", role: "user", body: "三千字左右" },
    ],
  },
  {
    id: "turn-7",
    kind: "assistant",
    summaryText: "好的，我先列提纲",
    metaText: "#7 · 工具调用 1 次 · 128 字",
    cards: [
      { type: "text", id: "card-a1", role: "assistant", body: "好的，我先列提纲" },
      {
        type: "toolGroup",
        id: "group-call-1",
        toolName: "list_chapters",
        inputJson: '{\n  "limit": 10\n}',
        inputPreview: '{\n  "limit": 10\n}',
        result: { toolUseId: "call-1", ok: true, body: "第一章 …" },
        status: "ok",
        parallel: false,
      },
    ],
  },
];

/**
 * 组卡三态夹具（ok / error / lost）+ thinking 卡 + 并行徽标，一次把 T-DP2 的
 * 状态点颜色、可读文案、丢失占位都覆盖掉。
 */
const TURNS_GROUP_STATES: PromptPreviewTurnDto[] = [
  {
    id: "turn-11",
    kind: "assistant",
    summaryText: "工具调用三态",
    metaText: "#11 · 工具调用 3 次 · 3 失败 · 1 丢失",
    cards: [
      { type: "thinking", id: "card-t1", role: "assistant", body: "（思考正文）" },
      {
        type: "toolGroup",
        id: "group-ok",
        toolName: "list_chapters",
        inputJson: '{ "limit": 3 }',
        inputPreview: '{ "limit": 3 }',
        result: { toolUseId: "call-ok", ok: true, body: "目录已返回" },
        status: "ok",
        parallel: true,
      },
      {
        type: "toolGroup",
        id: "group-error",
        toolName: "read_chapter",
        inputJson: '[tool_use name=read_chapter id=call-err]',
        inputPreview: '[tool_use name=read_chapter id=call-err]',
        result: { toolUseId: "call-err", ok: false, body: "Error: 章不存在" },
        status: "error",
        parallel: false,
      },
      {
        type: "toolGroup",
        id: "group-lost",
        toolName: "write_chapter",
        inputJson: '[tool_use name=write_chapter id=call-lost]',
        inputPreview: '[tool_use name=write_chapter id=call-lost]',
        result: null,
        status: "lost",
        parallel: false,
      },
    ],
  },
];

/**
 * 「整轮全屏」夹具：叶子卡 + 组卡混排，验证全屏是 cards 逐卡富文本流，
 * 且组卡两格（use 入参 / result 正文）都进流、不带 `[段名]` 前缀。
 */
const TURNS_FULLSCREEN: PromptPreviewTurnDto[] = [
  {
    id: "turn-13",
    kind: "assistant",
    summaryText: "全屏流夹具",
    metaText: "#13 · 工具调用 1 次 · 8 字",
    cards: [
      { type: "text", id: "card-a3", role: "assistant", body: "先列提纲" },
      {
        type: "toolGroup",
        id: "group-call-2",
        toolName: "read_chapter",
        inputJson: '[tool_use name=read_chapter id=call-2]',
        inputPreview: '[tool_use name=read_chapter id=call-2]',
        result: null,
        status: "lost",
        parallel: false,
      },
    ],
  },
];

/**
 * 退役字段残留夹具：payload 里**额外**塞回旧形态的 `body` / `items`。
 *
 * 契约要双侧锁定——handler 侧不再下发（见文末源码正则），renderer 侧也不消费。
 * 字段已从 `PromptPreviewTurnDto` 删除，这里用 cast 模拟「老 main 进程发来的 payload」。
 */
const TURNS_WITH_LEGACY_FIELDS = TURNS.map((turn) => ({
  ...turn,
  ...({
    body: "退役正文不应渲染",
    items: [
      { id: "evil-1", role: "assistant", title: "assistant", body: "偷跑段一" },
      { id: "evil-2", role: "tool_call", title: "tool_call", body: "偷跑段二" },
    ],
  } as Record<string, unknown>),
})) as PromptPreviewTurnDto[];

/**
 * 「老 main payload」夹具：轮对象**完全没有 `cards` 字段**。
 *
 * 仅 Electron dev 可达——renderer 走 HMR 而 main 进程不重启，旧 main 下发的轮还是
 * 重写前的形态（无 `cards`）。这里逐字段照抄 id/kind/summaryText/metaText，只丢掉
 * `cards`，模拟那份 payload。
 */
const TURNS_WITHOUT_CARDS = TURNS.map((turn) => ({
  id: turn.id,
  kind: turn.kind,
  summaryText: turn.summaryText,
  metaText: turn.metaText,
})) as unknown as PromptPreviewTurnDto[];

/** 最小 document 桩：只提供 keydown 监听注册/移除，够 Modal 的 Esc 链路用。 */
type KeydownListener = (e: { key: string; defaultPrevented: boolean }) => void;

interface DocumentStub {
  listeners: KeydownListener[];
  addEventListener: (type: string, fn: KeydownListener) => void;
  removeEventListener: (type: string, fn: KeydownListener) => void;
  press: (key: string, defaultPrevented?: boolean) => void;
}

function makeDocumentStub(): DocumentStub {
  const listeners: KeydownListener[] = [];
  const addEventListener = (type: string, fn: KeydownListener) => {
    if (type === "keydown") {
      listeners.push(fn);
    }
  };
  const removeEventListener = (type: string, fn: KeydownListener) => {
    if (type !== "keydown") {
      return;
    }
    const at = listeners.indexOf(fn);
    if (at >= 0) {
      listeners.splice(at, 1);
    }
  };
  return {
    listeners,
    addEventListener,
    removeEventListener,
    press: (key, defaultPrevented = false) => {
      for (const fn of [...listeners]) {
        fn({ key, defaultPrevented });
      }
    },
  };
}

/**
 * window 事件桩的监听器签名：只用到 detail，与 renderer 侧 `CustomEvent<T>` 收窄同形。
 */
type WindowListener = (e: { type: string; detail?: unknown }) => void;

/** 最小 CustomEvent 桩（node 测试环境无 DOM 构造器）。 */
class CustomEventStub {
  readonly type: string;
  readonly detail: unknown;
  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
}

/** 挂全局 window.novelMasterDesktop + document 桩，返回还原函数。 */
interface InstalledGlobals {
  restore: () => void;
  doc: DocumentStub;
  /** T-PR3：向 window 派发 CustomEvent（等价 ConversationPanel 的 dispatchEvent）。 */
  dispatchWindowEvent: (type: string, detail?: unknown) => void;
  /** T-PR3：换掉后续 `nm:prompt/realPreview` 的返回体，用来断言「数据真刷新了」。 */
  setTurns: (next: PromptPreviewTurnDto[]) => void;
  /** T-PR3：`nm:prompt/realPreview` 的累计调用次数（重取与否的直接证据）。 */
  ipcInvokeCount: () => number;
  /** T-PR3：当前 window 上某类事件的监听器个数（卸载清理断言用）。 */
  listenerCount: (type: string) => number;
}

function installGlobals(turns: PromptPreviewTurnDto[]): InstalledGlobals {
  const g = globalThis as unknown as {
    window?: unknown;
    document?: unknown;
    CustomEvent?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const prevWindow = g.window;
  const prevDocument = g.document;
  const prevCustomEvent = g.CustomEvent;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  const doc = makeDocumentStub();

  // 窗口事件：renderer 侧只走 `window.addEventListener` / `window.dispatchEvent`
  // （`SessionDetailDrawer` 订阅 context-changed、`ConversationPanel` 派发
  // session-compacted 同范式），node 环境无这套 API，这里补一份最小可运行实现。
  const listeners = new Map<string, WindowListener[]>();
  const ipcChannel = "nm:prompt/realPreview";
  let currentTurns = turns;
  let invokeCount = 0;

  g.window = {
    novelMasterDesktop: {
      invoke: (channel: string) => {
        if (channel === ipcChannel) {
          invokeCount += 1;
          return Promise.resolve({ ok: true, data: currentTurns });
        }
        return Promise.reject(new Error(`测试未预期的 IPC channel: ${channel}`));
      },
    },
    addEventListener: (type: string, fn: WindowListener) => {
      const bucket = listeners.get(type);
      if (bucket) {
        bucket.push(fn);
        return;
      }
      listeners.set(type, [fn]);
    },
    removeEventListener: (type: string, fn: WindowListener) => {
      const bucket = listeners.get(type);
      if (!bucket) {
        return;
      }
      const at = bucket.indexOf(fn);
      if (at >= 0) {
        bucket.splice(at, 1);
      }
    },
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      for (const fn of [...(listeners.get(event.type) ?? [])]) {
        fn(event);
      }
      return true;
    },
  };
  g.document = doc;
  g.CustomEvent = CustomEventStub;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    doc,
    dispatchWindowEvent: (type, detail) => {
      (g.window as { dispatchEvent: (e: unknown) => void }).dispatchEvent(
        new CustomEventStub(type, { detail }),
      );
    },
    setTurns: (next) => {
      currentTurns = next;
    },
    ipcInvokeCount: () => invokeCount,
    listenerCount: (type) => listeners.get(type)?.length ?? 0,
    restore: () => {
      g.window = prevWindow;
      g.document = prevDocument;
      g.CustomEvent = prevCustomEvent;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
    },
  };
}

/** 挂载面板并等 load 落地。 */
async function mountPanel(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      <RealPromptPanel projectId="p1" sessionId="s1" visible />,
    );
  });
  if (renderer == null) {
    throw new Error("渲染失败");
  }
  return renderer;
}

/**
 * 用指定轮数据挂载面板（覆盖 beforeEach 装好的默认 IPC 返回体）。
 *
 * ⚠️ **不在这里还原全局**：被挂载的面板已在临时 window 对象上注册了
 * `session-compacted` 监听（RealPromptPanel.tsx 的订阅 effect），提前 `restore()`
 * 会把全局 window 摘回 undefined——任一用例将来加 `renderer.unmount()` 时，React
 * 清理走 `window.removeEventListener` 直接 TypeError，报错点还离成因隔着一层 helper。
 * 故把 `restore` 一并交回调用方，在用例末尾（或所在 describe 的 `afterEach`）还原。
 */
async function mountPanelWith(
  turns: PromptPreviewTurnDto[],
): Promise<{ renderer: ReactTestRenderer; restore: () => void }> {
  const installed = installGlobals(turns);
  return { renderer: await mountPanel(), restore: installed.restore };
}

function classNodes(root: ReactTestRendererRoot, className: string) {
  return root.findAll(
    (node) => node.props?.className === className && typeof node.type === "string",
  );
}

/**
 * hasClass 口径的节点收集（类名合并后 className 不再全等匹配）。
 *
 * 三层结构里轮卡是 `prompt-turn prompt-turn-card prompt-turn--<kind>` 多类合并，
 * 组卡 / 叶子卡也带条件类（`is-expanded` / `is-lost`），断言这些类都得走本 helper。
 */
function classListNodes(root: ReactTestRendererRoot, className: string) {
  return root.findAll(
    (node) => typeof node.type === "string" && hasClass(node, className),
  );
}

/** 递归拼接节点子树文本。 */
function textOf(node: { children: null | unknown[] }): string {
  if (node.children == null) {
    return "";
  }
  return node.children
    .map((child) =>
      typeof child === "string" ? child : textOf(child as { children: unknown[] }),
    )
    .join("");
}

function hasClass(node: { props?: Record<string, unknown> }, className: string) {
  const raw = node.props?.className;
  return typeof raw === "string" && raw.split(/\s+/).includes(className);
}

/**
 * 触发节点 onClick。
 *
 * react-test-renderer 的 props 在本仓 tsconfig 下是宽松类型（`unknown` 收窄后
 * 调用点仍报错），这里统一走一次窄化：onClick 缺失即测试失败，不静默通过。
 */
function click(node: { props: unknown }, arg?: unknown): void {
  const handler = (node.props as { onClick?: (a?: unknown) => void } | null)
    ?.onClick;
  assert.equal(typeof handler, "function", "目标节点应挂 onClick");
  handler!(arg);
}

/** 断言节点挂着 onClick（整卡点按式全屏入口存在性检查）。 */
function expectClickable(node: { props: unknown }): void {
  const handler = (node.props as { onClick?: unknown } | null)?.onClick;
  assert.equal(typeof handler, "function", "目标节点应挂 onClick");
}

/** 取节点子树里第一个原生 button（轮卡头部 / footer 按钮都是原生 button）。 */
function firstNativeButton(node: {
  findAll: (p: (n: { type: unknown }) => boolean) => Array<{ props: unknown }>;
}): { props: unknown } {
  return node.findAll((n) => typeof n.type === "string" && n.type === "button")[0]!;
}

/** 取指定轮卡的展开态 toggle 按钮（`.prompt-turn-card__toggle`）。 */
function turnToggle(
  root: ReactTestRendererRoot,
  turnId: string,
): { props: unknown } {
  const turn = root.findAll(
    (node) =>
      typeof node.type === "string" && hasClass(node, "prompt-turn-card") &&
      node.props?.["data-turn-id"] === turnId,
  )[0]!;
  return turn.findAll(
    (n) => n.props?.className === "prompt-turn-card__toggle",
  )[0]!;
}

/**
 * 取节点的 aria-label。
 *
 * 与 `click()` 同一口径的理由：react-test-renderer 的 props 在本仓 tsconfig 下是
 * 宽松的 `unknown`，直接下标会撞 TS2571，这里统一走一次窄化。
 */
function ariaLabelOf(node: { props: unknown }): string {
  return String((node.props as { "aria-label"?: unknown } | null)?.["aria-label"]);
}

/** 点开某轮（toggle 展开），返回该轮的轮卡节点。 */
async function expandTurn(
  root: ReactTestRendererRoot,
  turnId: string,
): Promise<{ props: Record<string, unknown> }> {
  await act(async () => {
    click(turnToggle(root, turnId));
  });
  return root.findAll(
    (node) =>
      typeof node.type === "string" && hasClass(node, "prompt-turn-card") &&
      node.props?.["data-turn-id"] === turnId,
  )[0]!;
}

describe("RealPromptPanel 三层结构轮卡列表 + 全屏富文本 Modal (T-R6 / T-DP1~T-DP3)", () => {
  let restore: () => void;
  let doc: DocumentStub;
  /**
   * `mountPanelWith` 挂出来的那批（自带一份独立 IPC 全局桩），统一在 afterEach 里
   * **先 unmount 再 restore**——先卸载是必须的：面板的 `session-compacted` 订阅清理
   * 要用 window 桩，桩先没了会在 `removeEventListener` 上炸（见 mountPanelWith 注释）。
   */
  let mountedWith: Array<{
    renderer: ReactTestRenderer;
    restore: () => void;
  }> = [];

  beforeEach(() => {
    const installed = installGlobals(TURNS);
    restore = installed.restore;
    doc = installed.doc;
    mountedWith = [];
  });

  afterEach(async () => {
    for (const mounted of mountedWith) {
      await act(async () => {
        mounted.renderer.unmount();
      });
      mounted.restore();
    }
    restore();
  });

  it("T-DP1：system / user / assistant 三类轮统一渲染成轮摘要卡（徽标+单行摘要+meta 行）", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;

    // 四轮（system / workplace(user) / turn-5(user) / turn-7(assistant)），
    // data-turn-kind 一并钉住（workplace 轮 kind = 段消息 role user）。
    const turnCards = classListNodes(root, "prompt-turn-card");
    assert.equal(turnCards.length, 4);
    assert.deepEqual(
      turnCards.map((node) => node.props["data-turn-id"]),
      ["seg-sys", "prompt-workplace", "turn-5", "turn-7"],
    );
    assert.deepEqual(
      turnCards.map((node) => node.props["data-turn-kind"]),
      ["system", "user", "user", "assistant"],
    );
    // 每张轮卡都同时挂轮壳类与 kind 修饰类（三类统一外壳，只靠色条/徽标区分）
    for (const turnCard of turnCards) {
      assert.ok(hasClass(turnCard, "prompt-turn"), "轮卡应挂 .prompt-turn 轮壳类");
    }
    assert.equal(classListNodes(root, "prompt-turn--system").length, 1);
    assert.equal(classListNodes(root, "prompt-turn--user").length, 2);
    assert.equal(classListNodes(root, "prompt-turn--assistant").length, 1);

    // role 徽标 pill：三态走 CSS data-turn-kind（user 主蓝底/assistant 中性底/
    // system 中性底），renderer 不再持有 inline 色（对齐智能体配置 badge 体系）。
    const roles = classListNodes(root, "prompt-turn-card__role");
    assert.deepEqual(
      roles.map((node) => textOf(node)),
      ["system", "user", "user", "assistant"],
    );
    assert.deepEqual(
      roles.map((node) => (node.props as { "data-turn-kind": unknown })["data-turn-kind"]),
      ["system", "user", "user", "assistant"],
    );
    for (const role of roles) {
      assert.equal((role.props as { style?: unknown }).style, undefined);
    }

    // summaryText 单行摘要 + metaText 计数行（摘要不二次加工，直接读 core 字段）
    const summaries = classListNodes(root, "prompt-turn-card__summary");
    assert.deepEqual(
      summaries.map((node) => textOf(node)),
      ["system", "workplace", "帮我写第一章", "好的，我先列提纲"],
    );
    const metas = classListNodes(root, "prompt-turn-card__meta");
    assert.deepEqual(
      metas.map((node) => textOf(node)),
      ["6 字", "28 字", "#5 · 15 字", "#7 · 工具调用 1 次 · 128 字"],
    );
    // meta 行同时挂 .prompt-segment__preview（契约类名保留）
    for (const meta of metas) {
      assert.ok(hasClass(meta, "prompt-segment__preview"));
    }

    // 轮卡不再出整轮全屏 ⤢（用户拍板：全屏入口只在二级卡）；默认收起无展开区/Modal
    assert.equal(classListNodes(root, "prompt-turn-card__fullscreen").length, 0);
    assert.equal(classListNodes(root, "prompt-turn-card__body").length, 0);
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
  });

  it("T-WP1：workplace 轮展开即文件列表（无组头）→预览卡→全屏原文", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;

    // 点轮头展开：直接见文件列表（不再嵌 workplace 组头——用户拍板）。
    await expandTurn(root, "prompt-workplace");
    assert.equal(classListNodes(root, "prompt-workplace").length, 1);
    assert.equal(
      root.findAll((n) => typeof n.type === "string" && hasClass(n, "prompt-workplace__head")).length,
      0,
      "不应再有 workplace 组头",
    );
    // 文件列表行（路径 + 展示档文案，单行无正文）。
    const files = classListNodes(root, "prompt-workplace__file");
    assert.deepEqual(
      files.map((node) => node.props["data-file-path"]),
      ["outline/大纲.md", "notes/草稿.txt"],
    );
    assert.deepEqual(
      classListNodes(root, "prompt-workplace__file-display").map((n) => textOf(n)),
      ["全内容", "文件名"],
    );
    assert.equal(
      root.findAll((n) => typeof n.type === "string" && hasClass(n, "prompt-workplace__preview")).length,
      0,
      "列表行未展开时不出预览卡",
    );

    // 点列表行 → 就地展开预览卡（块内正文，限 6 行由 css 承担）。
    await act(async () => {
      click(files[0]!);
    });
    const previews = classListNodes(root, "prompt-workplace__preview");
    assert.equal(previews.length, 1);
    assert.equal(textOf(previews[0]!), "1|第一行\n2|第二行");

    // 点预览卡 → 全屏原文（标题 = 路径，正文 = 块内正文）。
    await act(async () => {
      click(previews[0]!);
    });
    const raws = classListNodes(root, "prompt-fullscreen__raw");
    assert.equal(raws.length, 1);
    assert.equal(textOf(raws[0]!), "1|第一行\n2|第二行");
    assert.equal(
      textOf(classNodes(root, "prompt-fullscreen__title")[0]!),
      "outline/大纲.md",
    );
  });

  it("T-DP1：点头部就地展开 → 渲染 turn.cards 叶子卡，再点收起", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;

    const turn = await expandTurn(root, "turn-5");
    assert.ok(hasClass(turn, "is-expanded"), "展开后轮卡应挂 is-expanded");

    // 展开区挂载 cards 叶子卡，id 即 core 的卡片 id
    const leafCards = classListNodes(root, "prompt-leaf-card");
    assert.deepEqual(
      leafCards.map((node) => node.props["data-card-id"]),
      ["card-u1", "card-u2"],
    );
    // 叶子卡：无 kind 小标签（用户拍板），正文预览直接铺（限行由 CSS 承担，见 T-DP5）
    assert.equal(
      root.findAll(
        (n) => n.props?.className === "prompt-leaf-card__kind",
      ).length,
      0,
    );
    assert.match(textOf(leafCards[0]!), /帮我写第一章/);
    assert.match(textOf(leafCards[1]!), /三千字左右/);

    // 再点一次收起：展开区与卡片都消失
    await act(async () => {
      click(turnToggle(root, "turn-5"));
    });
    assert.equal(classListNodes(root, "prompt-turn-card__body").length, 0);
    assert.equal(classListNodes(root, "prompt-leaf-card").length, 0);
    // 别的轮仍是收起态（展开 map 按轮 id 隔离）
    assert.equal(classListNodes(root, "is-expanded").length, 0);
  });

  it("T-DP2：展开区渲染组卡三态（ok / error / lost）+ 并行徽标 + use/result 两格", async () => {
    const mounted = await mountPanelWith(TURNS_GROUP_STATES);
    mountedWith.push(mounted);
    const root = mounted.renderer.root;
    await expandTurn(root, "turn-11");

    // thinking 叶子卡与三张组卡按 cards 顺序平铺
    assert.equal(classListNodes(root, "prompt-leaf-card").length, 1);
    assert.match(
      textOf(classListNodes(root, "prompt-leaf-card")[0]!),
      /（思考正文）/,
    );
    assert.equal(classListNodes(root, "prompt-leaf-card--thinking").length, 1);

    const groups = classListNodes(root, "prompt-tool-group");
    assert.equal(groups.length, 3);
    assert.deepEqual(
      groups.map((node) => node.props["data-card-status"]),
      ["ok", "error", "lost"],
    );

    // 组头：工具名 + 状态点三色（ok 绿 / error 红 / lost 灰）+ 状态文案
    assert.deepEqual(
      groups.map((node) =>
        textOf(node.findAll(
          (n) => n.props?.className === "prompt-tool-group__name",
        )[0]!),
      ),
      ["list_chapters", "read_chapter", "write_chapter"],
    );
    assert.deepEqual(
      groups.map((node) =>
        (node.findAll(
          (n) => n.props?.className === "prompt-tool-group__dot",
        )[0]!.props as { style: { background: string } }).style.background,
      ),
      ["var(--success)", "var(--danger)", "var(--text-tertiary)"],
    );
    assert.deepEqual(
      groups.map((node) => textOf(node).match(/成功|失败|丢失/)![0]),
      ["成功", "失败", "丢失"],
    );

    // 并行徽标只挂在 parallel=true 的组卡上
    assert.equal(classListNodes(root, "prompt-tool-group__parallel").length, 1);
    assert.match(textOf(groups[0]!), /并行/);
    assert.equal(groups[1]!.findAll(
      (n) => n.props?.className === "prompt-tool-group__parallel",
    ).length, 0);

    // 组卡默认收起，两格不渲染
    assert.equal(classListNodes(root, "prompt-group-cell").length, 0);

    // 展开组卡 → use / result 两格（等宽入参格 + 正文格），悬挂格走 is-lost 占位
    await act(async () => {
      click(
        classListNodes(root, "prompt-tool-group")[0]!.findAll(
          (n) => n.props?.className === "prompt-tool-group__head",
        )[0]!,
      );
    });
    const cells = classListNodes(root, "prompt-group-cell");
    assert.equal(cells.length, 2);
    assert.deepEqual(
      cells.map((node) => node.props["data-leaf-id"]),
      ["group-ok-use", "group-ok-result"],
    );
    assert.match(textOf(cells[0]!), /tool use/);
    assert.match(textOf(cells[0]!), /"limit": 3/);
    assert.match(textOf(cells[1]!), /tool result/);
    assert.match(textOf(cells[1]!), /目录已返回/);
    // 入参格等宽（is-code），结果格不是
    assert.equal(
      cells[0]!.findAll(
        (n) => typeof n.type === "string" && hasClass(n, "prompt-group-cell__body"),
      ).filter((n) => hasClass(n, "is-code")).length,
      1,
    );

    // 丢失态组卡：展开后出「未返回结果」占位 + is-lost 灰化
    await act(async () => {
      click(
        classListNodes(root, "prompt-tool-group")[2]!.findAll(
          (n) => n.props?.className === "prompt-tool-group__head",
        )[0]!,
      );
    });
    const lostCells = classListNodes(root, "prompt-group-cell").filter((n) =>
      hasClass(n, "is-lost"),
    );
    assert.equal(lostCells.length, 1);
    assert.match(textOf(lostCells[0]!), /未返回结果/);
    // 组卡展开 map 按 turn.id + card.id 隔离：中间 error 组卡仍是收起态
    assert.equal(
      classListNodes(root, "prompt-tool-group").filter((n) =>
        hasClass(n, "is-expanded"),
      ).length,
      2,
    );
  });

  it("T-DP3：点叶子卡 → Modal 固定原文档（pre 铺开、无渲染管线）", async () => {
    const mounted = await mountPanelWith(TURNS_FULLSCREEN);
    mountedWith.push(mounted);
    const root = mounted.renderer.root;
    await expandTurn(root, "turn-13");

    await act(async () => {
      click(classListNodes(root, "prompt-leaf-card")[0]!);
    });

    const overlays = classNodes(root, "text-prompt-overlay");
    assert.equal(overlays.length, 1);
    const modal = root.findAll((node) => node.props?.role === "dialog")[0]!;
    assert.equal(modal.props["aria-modal"], "true");
    assert.match(String(modal.props["aria-label"]), /assistant详情/);
    // 壳复用：.text-prompt-overlay / .prompt-editor-modal / footer 全在
    assert.equal(
      modal.findAll(
        (node) => node.props?.className === "prompt-editor-modal__footer",
      ).length,
      1,
    );
    // 正文容器 .prompt-fullscreen__body 内是 pre 原文（用户拍板：只保留原文）
    const body = modal.findAll(
      (node) => node.props?.className === "prompt-fullscreen__body",
    )[0]!;
    const raws = body.findAll(
      (node) => typeof node.type === "string" && hasClass(node, "prompt-fullscreen__raw"),
    );
    assert.equal(raws.length, 1);
    assert.equal(textOf(raws[0]!), "先列提纲");
    // 渲染管线已从面板退役（源码契约用例断言 doesNotMatch MermaidMarkdown）。
    // CodeEditor 已从本面板退役
    assert.equal(
      (globalThis as unknown as { __promptTurnCodeEditorProps?: unknown[] })
        .__promptTurnCodeEditorProps?.length ?? 0,
      0,
      "面板不应再挂 CodeEditor",
    );
  });

  it("T-DP3：轮卡/叶子卡/格子都不再出显式 ⤢（点击就好进入全屏）", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    assert.equal(
      classListNodes(root, "prompt-turn-card__fullscreen").length,
      0,
      "轮卡不应出 ⤢",
    );
    await expandTurn(root, "turn-7");
    await act(async () => {
      click(classNodes(root, "prompt-tool-group__head")[0]!);
    });
    assert.equal(classListNodes(root, "prompt-leaf-card__fullscreen").length, 0);
    assert.equal(classListNodes(root, "prompt-group-cell__fullscreen").length, 0);
    // 整卡点按仍是全屏入口（下一用例覆盖载荷）。
    expectClickable(classListNodes(root, "prompt-leaf-card")[0]!);
    expectClickable(classListNodes(root, "prompt-group-cell")[0]!);
  });

  it("T-DP3：叶子卡与组卡格子各自点开全屏（单份正文），互不串台", async () => {
    const mounted = await mountPanelWith(TURNS_GROUP_STATES);
    mountedWith.push(mounted);
    const root = mounted.renderer.root;
    await expandTurn(root, "turn-11");

    // 叶子卡（thinking）→ 全屏正文就是该卡 body
    await act(async () => {
      click(classListNodes(root, "prompt-leaf-card")[0]!);
    });
    let raws = classListNodes(root, "prompt-fullscreen__raw");
    assert.equal(raws.length, 1);
    assert.equal(textOf(raws[0]!), "（思考正文）");
    const title = classNodes(root, "prompt-fullscreen__title")[0]!;
    assert.equal(textOf(title), "thinking");
    // 先关掉，避免与下一段串台
    await act(async () => {
      click(classNodes(root, "text-prompt-overlay")[0]!);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);

    // 展开 error 组卡，点其 tool result 格 → 全屏只有 result 正文
    await act(async () => {
      click(
        classListNodes(root, "prompt-tool-group")[1]!.findAll(
          (n) => n.props?.className === "prompt-tool-group__head",
        )[0]!,
      );
    });
    const errorCells = classListNodes(root, "prompt-tool-group").filter(
      (node) => node.props["data-card-id"] === "group-error",
    )[0]!.findAll(
      (n) => typeof n.type === "string" && hasClass(n, "prompt-group-cell"),
    );
    assert.equal(errorCells.length, 2);
    await act(async () => {
      click(errorCells[1]!);
    });
    raws = classListNodes(root, "prompt-fullscreen__raw");
    assert.equal(raws.length, 1);
    assert.equal(textOf(raws[0]!), "Error: 章不存在");
    assert.equal(textOf(classNodes(root, "prompt-fullscreen__title")[0]!), "tool result");
  });

  it("Esc 关闭全屏 Modal；defaultPrevented 的 Esc 不拦截", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    // 点 system 轮的叶子卡开全屏（整卡点按式入口）
    await expandTurn(root, "seg-sys");
    await act(async () => {
      click(classListNodes(root, "prompt-leaf-card")[0]!);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 1);

    // 已被下游消费掉的 Esc（defaultPrevented）不关闭
    await act(async () => {
      doc.press("Escape", true);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 1);

    await act(async () => {
      doc.press("Escape");
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
  });

  it("footer 关闭按钮关闭全屏 Modal（点遮罩同样关闭）", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    const openFullscreen = async () => {
      // 只在首次展开轮卡（二次调用时轮已展开，重复 toggle 会把卡片收掉）。
      if (classListNodes(root, "prompt-leaf-card").length === 0) {
        await expandTurn(root, "turn-5");
      }
      await act(async () => {
        click(classListNodes(root, "prompt-leaf-card")[0]!);
      });
    };

    await openFullscreen();
    let modal = root.findAll((node) => node.props?.role === "dialog")[0]!;
    // Modal 内容区点自身不关闭（stopPropagation），点遮罩才关
    await act(async () => {
      click(modal, { stopPropagation: () => {} });
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 1);

    await act(async () => {
      click(classNodes(root, "text-prompt-overlay")[0]!);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);

    // footer 关闭按钮
    await openFullscreen();
    modal = root.findAll((node) => node.props?.role === "dialog")[0]!;
    const footer = modal.findAll(
      (node) => node.props?.className === "prompt-editor-modal__footer",
    )[0]!;
    const closeBtn = firstNativeButton(footer);
    await act(async () => {
      click(closeBtn);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
  });

  it("visible=false 不渲染列表", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <RealPromptPanel projectId="p1" sessionId="s1" visible={false} />,
      );
    });
    assert.equal(renderer!.toJSON(), null);
  });

  it("退役字段 body / items 即使残留在 payload 里也不参与渲染（双侧锁定）", async () => {
    const mounted = await mountPanelWith(TURNS_WITH_LEGACY_FIELDS);
    mountedWith.push(mounted);
    const { renderer } = mounted;
    const root = renderer.root;

    // 轮卡列表条数与基线一致（3 轮 → 3 张卡），未被 items 撑大
    assert.equal(classListNodes(root, "prompt-turn-card").length, 4);
    // 展开 assistant 轮后，卡片流仍只有 cards 里的 2 张（1 文本 + 1 组卡）
    await expandTurn(root, "turn-7");
    assert.deepEqual(
      classListNodes(root, "prompt-leaf-card").map((n) => n.props["data-card-id"]),
      ["card-a1"],
    );
    assert.deepEqual(
      classListNodes(root, "prompt-tool-group").map((n) => n.props["data-card-id"]),
      ["group-call-1"],
    );
    // 偷跑的段一条都没渲染出来
    assert.equal(
      root.findAll((node) => node.props?.["data-card-id"] === "evil-1").length,
      0,
    );
    assert.equal(
      root.findAll((node) => node.props?.["data-card-id"] === "evil-2").length,
      0,
    );
    assert.doesNotMatch(renderer.toJSON() ? JSON.stringify(renderer.toJSON()) : "", /偷跑段/);
    assert.doesNotMatch(renderer.toJSON() ? JSON.stringify(renderer.toJSON()) : "", /退役正文/);
  });

  it("防御：payload 的轮没有 cards 字段（旧 main）→ 轮卡照常渲染，展开区为空且不崩", async () => {
    const mounted = await mountPanelWith(TURNS_WITHOUT_CARDS);
    mountedWith.push(mounted);
    const root = mounted.renderer.root;

    // 三张轮卡照常出（摘要/meta 行不依赖 cards）
    assert.equal(classListNodes(root, "prompt-turn-card").length, 4);
    assert.deepEqual(
      classListNodes(root, "prompt-turn-card__summary").map((node) => textOf(node)),
      ["system", "workplace", "帮我写第一章", "好的，我先列提纲"],
    );

    // 展开轮卡：展开区挂载了，但一张卡都没有（cards 被归一化成空数组）
    await expandTurn(root, "turn-7");
    assert.equal(classListNodes(root, "prompt-turn-card__body").length, 1);
    assert.equal(classListNodes(root, "prompt-leaf-card").length, 0);
    assert.equal(classListNodes(root, "prompt-tool-group").length, 0);
  });

  it("切会话（sessionId 变）→ 展开态与全屏一并清空，不带到下一会话", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;

    // 先把 user 轮展开 + 点叶子卡开全屏，两个临时态都挂上
    await expandTurn(root, "turn-5");
    await act(async () => {
      click(classListNodes(root, "prompt-leaf-card")[0]!);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 1);
    assert.equal(classListNodes(root, "is-expanded").length, 1);

    // 切到同项目下的另一个会话（轮 id 是会话内相对序号，新旧 id 会撞）
    await act(async () => {
      renderer.update(
        <RealPromptPanel projectId="p1" sessionId="s2" visible />,
      );
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
    assert.equal(classListNodes(root, "is-expanded").length, 0);
    assert.equal(classListNodes(root, "prompt-turn-card__body").length, 0);
  });

  it("J-1：读屏标签带内容——叶子卡带 kind+正文，轮卡 toggle 带 role+摘要", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    await expandTurn(root, "turn-5");

    // 叶子卡：同 kind 多张并排时，靠正文前 20 字才念得出区别
    assert.deepEqual(
      classListNodes(root, "prompt-leaf-card").map(ariaLabelOf),
      ["user，帮我写第一章", "user，三千字左右"],
    );

    // 轮卡 toggle：带 role 与摘要，收起/展开两种文案都翻
    assert.equal(
      ariaLabelOf(turnToggle(root, "turn-5")),
      "收起user轮，帮我写第一章",
    );
    await act(async () => {
      click(turnToggle(root, "turn-5"));
    });
    assert.equal(
      ariaLabelOf(turnToggle(root, "turn-5")),
      "展开user轮，帮我写第一章",
    );
  });

  it("J-1：组卡两格的读屏标签带工具名（同名工具的两格也分得开）", async () => {
    const mounted = await mountPanelWith(TURNS_GROUP_STATES);
    mountedWith.push(mounted);
    const root = mounted.renderer.root;
    await expandTurn(root, "turn-11");
    await act(async () => {
      click(
        classListNodes(root, "prompt-tool-group")[0]!.findAll(
          (n) => n.props?.className === "prompt-tool-group__head",
        )[0]!,
      );
    });

    assert.deepEqual(
      classListNodes(root, "prompt-group-cell").map(ariaLabelOf),
      ["查看tool use，list_chapters", "查看tool result，list_chapters"],
    );
  });
});

/**
 * T-G1（cr-desktop/G-1）：`mountPanelWith` 不再在 helper 内部提前还原全局。
 *
 * 本 describe **故意不装任何前置全局桩**——这正是该用例的价值所在：若 helper
 * 仍在 `finally` 里 `restore()`，全局 window 会被摘回 undefined，随后任一用例
 * `renderer.unmount()` 触发 React 清理走 `window.removeEventListener` 即 TypeError，
 * 且报错点离成因隔着一层 helper。若放在外层 describe（其 `beforeEach` 已先装过一份
 * 桩）里跑，restore 只是换回另一份 stub，炸不出来，用例就成了假绿。
 */
describe("T-G1：mountPanelWith 交回还原（先卸载、后还原）", () => {
  it("mountPanelWith 挂载的面板，unmount 不抛错", async () => {
    const { renderer, restore: restoreWith } = await mountPanelWith(
      TURNS_GROUP_STATES,
    );
    try {
      assert.equal(classListNodes(renderer.root, "prompt-turn-card").length, 1);

      // 订阅 effect 已在临时 window 上挂了 `session-compacted` 监听，卸载会走
      // window.removeEventListener——桩仍在，故此处必须干净通过。
      await act(async () => {
        renderer.unmount();
      });
      assert.equal(renderer.toJSON(), null, "卸载后无残留树");
    } finally {
      // 卸载完成才轮到还原全局（顺序反了就会在 removeEventListener 上炸）。
      restoreWith();
    }
  });
});

describe("T-PR3：手动压缩成功后按 sessionId 订阅 window 事件重取", () => {
  let restore: () => void;
  let dispatchWindowEvent: (type: string, detail?: unknown) => void;
  let setTurns: (next: PromptPreviewTurnDto[]) => void;
  let ipcInvokeCount: () => number;
  let listenerCount: (type: string) => number;

  beforeEach(() => {
    const installed = installGlobals(TURNS);
    restore = installed.restore;
    dispatchWindowEvent = installed.dispatchWindowEvent;
    setTurns = installed.setTurns;
    ipcInvokeCount = installed.ipcInvokeCount;
    listenerCount = installed.listenerCount;
  });

  afterEach(() => {
    restore();
  });

  it("T-PR3：sessionId 匹配 + visible 时收到 session-compacted → 面板重取且数据刷新", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    assert.equal(ipcInvokeCount(), 1, "挂载时（visible）应已取数一次");
    assert.equal(listenerCount("session-compacted"), 1, "应订阅了压缩事件");

    // 压缩后 workplace 重评估：返回体换成只有一轮的压缩后快照。
    setTurns(TURNS_GROUP_STATES);
    await act(async () => {
      dispatchWindowEvent("session-compacted", { sessionId: "s1" });
    });

    assert.equal(ipcInvokeCount(), 2, "匹配会话的压缩事件应触发一次重取");
    assert.deepEqual(
      classListNodes(root, "prompt-turn-card").map((n) => n.props["data-turn-id"]),
      ["turn-11"],
      "重取后的轮卡应为新数据",
    );
  });

  it("T-PR3：sessionId 不匹配 / 载荷缺 sessionId → 不重取", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    assert.equal(ipcInvokeCount(), 1);

    await act(async () => {
      dispatchWindowEvent("session-compacted", { sessionId: "other-session" });
    });
    assert.equal(ipcInvokeCount(), 1, "别的会话压缩不应让本面板重取");

    await act(async () => {
      dispatchWindowEvent("session-compacted");
    });
    assert.equal(ipcInvokeCount(), 1, "缺 sessionId 的载荷不应触发重取");

    // 事件落到别的名字上也不该被当压缩信号（订阅是按类型精确匹配的）。
    await act(async () => {
      dispatchWindowEvent("context-changed", { sessionId: "s1" });
    });
    assert.equal(ipcInvokeCount(), 1, "本面板只订阅 session-compacted");

    // 原数据仍在（没被清空）
    assert.equal(classListNodes(root, "prompt-turn-card").length, 4);
  });

  it("T-PR3：visible=false 时不订阅也不因压缩事件重取", async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <RealPromptPanel projectId="p1" sessionId="s1" visible={false} />,
      );
    });
    assert.equal(ipcInvokeCount(), 0, "不可见时不取数");
    assert.equal(listenerCount("session-compacted"), 0, "不可见时不必订阅");

    await act(async () => {
      dispatchWindowEvent("session-compacted", { sessionId: "s1" });
    });
    assert.equal(ipcInvokeCount(), 0, "不可见时压缩事件不应触发重取");

    // 翻成可见后补订阅，并按 visible 翻转这条既有链路取数一次。
    await act(async () => {
      renderer!.update(<RealPromptPanel projectId="p1" sessionId="s1" visible />);
    });
    assert.equal(ipcInvokeCount(), 1);
    assert.equal(listenerCount("session-compacted"), 1);

    await act(async () => {
      dispatchWindowEvent("session-compacted", { sessionId: "s1" });
    });
    assert.equal(ipcInvokeCount(), 2, "可见后压缩事件应恢复触发重取");
  });

  it("T-PR3：切会话后监听器跟随新 sessionId（不按旧会话重取），卸载时移除监听", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    assert.equal(ipcInvokeCount(), 1);
    assert.equal(listenerCount("session-compacted"), 1);

    // 切到 s2：既有 effect 取数一次，且订阅重挂到 s2 上（监听器总数仍为 1）。
    await act(async () => {
      renderer.update(<RealPromptPanel projectId="p1" sessionId="s2" visible />);
    });
    assert.equal(ipcInvokeCount(), 2);
    assert.equal(listenerCount("session-compacted"), 1, "旧监听器应被移除，不叠加");

    // 旧会话 id 的事件此时不得再触发重取（stale closure 守卫）。
    await act(async () => {
      dispatchWindowEvent("session-compacted", { sessionId: "s1" });
    });
    assert.equal(ipcInvokeCount(), 2, "切会话后旧 sessionId 的事件不应触发重取");

    await act(async () => {
      dispatchWindowEvent("session-compacted", { sessionId: "s2" });
    });
    assert.equal(ipcInvokeCount(), 3, "新 sessionId 的事件应触发重取");

    await act(async () => {
      renderer.unmount();
    });
    assert.equal(listenerCount("session-compacted"), 0, "卸载应移除监听");
    // 卸载后再派发不再有任何副作用。
    await act(async () => {
      dispatchWindowEvent("session-compacted", { sessionId: "s2" });
    });
    assert.equal(ipcInvokeCount(), 3);
    assert.ok(root != null);
  });
});

describe("T-R6 契约层：payload 策略 / CodeEditor readOnly / 样式", () => {
  it("T-DP4：handler map 全轮统一下发 cards，body / items 不再下发（payload 策略已反转）", () => {
    const src = readFileSync(
      join(desktopRoot, "src", "main", "ipc", "handlers", "prompt.ts"),
      "utf8",
    );
    // 轮 DTO 返回类型
    assert.match(src, /IpcResult<PromptPreviewTurnDto\[\]>/);
    assert.match(src, /buildRealPromptPreviewTurns/);
    // 正向：三类轮统一形态——摘要与计数分列，cards 是唯一正文载体
    assert.match(src, /summaryText: turn\.summaryText/);
    assert.match(src, /metaText: turn\.metaText/);
    assert.match(src, /cards: turn\.cards\.map\(/);
    // 反向：不再有 assistant / 非 assistant 三元分叉
    assert.doesNotMatch(src, /turn\.kind === "assistant"/);
    assert.doesNotMatch(src, /turn\.body/);
    assert.doesNotMatch(src, /turn\.items/);
    assert.doesNotMatch(src, /\bitems:/);
  });

  it("T-DP4：ipc-types 的轮 DTO 只剩 {id, kind, summaryText, metaText, cards}，段 DTO 已删除", () => {
    const src = readFileSync(join(desktopRoot, "shared", "ipc-types.ts"), "utf8");
    assert.match(src, /export type PromptPreviewTurnDto = \{/);
    assert.match(src, /readonly cards: readonly PromptTurnCardDto\[\];/);
    // 组卡 / 文本卡 DTO 与 core 判别联合对齐（discriminator = type）
    assert.match(src, /export type PromptToolGroupDto = \{/);
    assert.match(src, /readonly type: 'toolGroup';/);
    assert.match(src, /export type PromptTextCardDto = \{/);
    assert.match(src, /readonly type: 'text' \| 'thinking';/);
    assert.match(src, /export type PromptTextCardDto = \{/);
    assert.match(src, /export type PromptToolGroupDto = \{/);
    assert.match(src, /export type PromptWorkplaceDto = \{/);
    // 轮卡片联合含三成员（text/thinking、toolGroup、workplace）
    assert.match(
      src,
      /export type PromptTurnCardDto =\r?\n  \| PromptTextCardDto\r?\n  \| PromptToolGroupDto\r?\n  \| PromptWorkplaceDto;/,
    );
    // 反向：旧形态的段 DTO 与可选字段全部退役
    assert.doesNotMatch(src, /PromptPreviewSegmentDto/);
    // 只截 PromptPreviewTurnDto 的类型体比对，并剥掉行内注释，免得注释里解释
    // 「为何退役」的 body / items 字样把断言误伤。
    const turnDtoStart = src.indexOf("export type PromptPreviewTurnDto = {");
    const turnDtoBody = src
      .slice(turnDtoStart, src.indexOf("\n};", turnDtoStart))
      .replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(turnDtoStart > 0, "ipc-types 里应有 PromptPreviewTurnDto");
    assert.doesNotMatch(turnDtoBody, /\bbody\b/);
    assert.doesNotMatch(turnDtoBody, /\bitems\b/);
    assert.doesNotMatch(turnDtoBody, /\bsummary\b/);
  });

  it("CodeEditor：readOnly 加 readOnly 扩展、关 history/closeBrackets、onChange 可选且只读不挂", () => {
    const src = readFileSync(
      join(rendererRoot, "components", "ui", "CodeEditor.tsx"),
      "utf8",
    );
    assert.match(src, /EditorState\.readOnly\.of\(true\)/);
    assert.match(src, /EditorView\.editable\.of\(false\)/);
    assert.match(src, /onChange=\{/); // 只读态不挂 onChange 回调
    // 判别联合：只读态禁 onChange/onSave，可编辑态必须给 onChange
    assert.match(src, /readOnly: true;/);
    assert.match(src, /onChange\?: never;/);
    assert.match(src, /onSave\?: never;/);
    assert.match(src, /readOnly\?: false;/);
    assert.match(src, /onChange: \(value: string\) => void/);
    assert.match(src, /onSave\?: \(\) => void/);
    assert.match(src, /readOnly \? undefined : onChange/);
    assert.match(src, /history: !readOnly/);
    assert.match(src, /closeBrackets: !readOnly/);
    // 复制所需的选择态仍保留
    assert.match(src, /drawSelection: true/);
  });

  it("RealPromptPanel：三层结构源码契约（轮卡 + 组卡/叶子卡/workplace 列表 + Modal 固定原文）", () => {
    const src = readFileSync(
      join(rendererRoot, "features", "chat", "RealPromptPanel.tsx"),
      "utf8",
    );
    // 文件头注释里解释「只读」时会提到 onLinkClick / CodeEditor，反向断言得先剥注释。
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Modal 壳沿用既有三类（不动 .text-prompt-overlay / .prompt-editor-modal）
    assert.match(code, /className="text-prompt-overlay"/);
    assert.match(code, /className="prompt-editor-modal"/);
    assert.match(code, /className="prompt-editor-modal__footer"/);
    // 正文容器 .prompt-fullscreen__body 内挂 pre 原文（用户拍板：只保留原文，
    // MermaidMarkdown 渲染档与切换控件一并退役）。
    assert.match(code, /className="prompt-fullscreen__body"/);
    assert.match(code, /prompt-fullscreen__raw/);
    assert.doesNotMatch(code, /MermaidMarkdown/);
    // 轮卡读 core 钉死的 summaryText / metaText（旧 summary 拼串已退役），不再二次加工
    assert.match(code, /turn\.summaryText/);
    assert.match(code, /turn\.metaText/);
    // 轮卡列表 + 展开态受控 map（轮 key = turn.id，组卡 key = turn.id + card.id）
    assert.match(code, /className=\{`prompt-turn prompt-turn--\$\{turn\.kind\}/);
    assert.match(code, /expanded\[`\$\{turnId\}::\$\{card\.id\}`\]/);
    // 组卡 toggle 写入侧与读取侧同 key（否则展开态写进去读不出来）
    assert.match(code, /onToggle=\{\(cardId\) => toggleExpanded\(`\$\{turnId\}::\$\{cardId\}`\)\}/);
    // 轮层 role 徽标三态经 data-turn-kind 下发（CSS 侧消费，无 inline 色 map）
    assert.match(code, /data-turn-kind=\{turn\.kind\}/);
    assert.doesNotMatch(code, /TURN_ROLE_COLORS/);
    // 展开区渲染 cards：新组件是纯展示（无跳转回调），不复用聊天页 ToolCall* 组件
    assert.match(code, /PromptToolGroupCard/);
    assert.match(code, /PromptLeafCard/);
    assert.doesNotMatch(code, /ToolCallGroupCard/);
    assert.doesNotMatch(code, /ToolCallCard/);
    // CodeEditor 已从本面板退役（含 editorProps / __promptTurnCodeEditorProps glue）
    assert.doesNotMatch(code, /CodeEditor/);
    assert.doesNotMatch(code, /editorProps/);
    assert.doesNotMatch(code, /__promptTurnCodeEditorProps/);
    assert.doesNotMatch(code, /languagePath/);
    assert.doesNotMatch(code, /cardsToDetailText/);
    // 整轮全屏入口已退役（openTurnFullscreen / cardBodies / ⤢ 按钮全删）
    assert.doesNotMatch(code, /openTurnFullscreen/);
    assert.doesNotMatch(code, /cardBodies/);
    assert.doesNotMatch(code, /turn-fullscreen/);
    // 渲染/原文切换已退役（fixed 原文档）
    assert.doesNotMatch(code, /fullscreenKind/);
  });

  it("T-DP5：shell.css 保留旧契约类名 + 新增三层结构样式类", () => {
    const css = readFileSync(join(rendererRoot, "styles", "shell.css"), "utf8");
    // 契约类名收窄为四项：轮卡壳 + 轮壳 + 两处仍在消费的 __preview / __chevron。
    // `.prompt-segment` 基类族随面板重写整族删除（desktop/C-1），唯二真消费子类是
    // __preview / __chevron，hover 基线挂 `.prompt-turn-card__head` 而非轮卡壳。
    assert.match(css, /\.prompt-turn-card \{/);
    assert.match(css, /\.prompt-turn \{/);
    assert.match(css, /\.prompt-turn-card \.prompt-segment__preview \{/);
    assert.match(css, /\.prompt-segment__chevron \{/);
    assert.doesNotMatch(css, /\.prompt-segment \{/);
    assert.doesNotMatch(css, /\.prompt-turn-card:hover \{/);
    // 轮卡头：10px 圆角内衬块（hover 底色不再画直角矩形）+ 键盘焦点环
    const head = css.slice(
      css.indexOf(".prompt-turn-card__head {"),
      css.indexOf("}", css.indexOf(".prompt-turn-card__head {")),
    );
    assert.match(head, /border-radius: 10px;/);
    assert.match(css, /\.prompt-turn-card__head:focus-within \{/);
    assert.match(css, /outline: 1px solid var\(--primary\);/);
    // 新增：轮卡头 / 摘要单行截断 / 展开区
    assert.match(css, /\.prompt-turn-card__head \{/);
    assert.match(css, /\.prompt-turn-card__summary \{/);
    assert.match(css, /\.prompt-turn-card__body \{/);
    // 新增：叶子卡（限 3 行预览）+ 工具组卡 + 组内两格 + 全屏正文容器
    assert.match(css, /\.prompt-leaf-card \{/);
    assert.match(css, /\.prompt-leaf-card__preview \{/);
    assert.match(css, /\.prompt-tool-group \{/);
    assert.match(css, /\.prompt-group-cell \{/);
    assert.match(css, /\.prompt-fullscreen__body \{/);
    // 限行口径（用户拍板预览高度翻倍）：叶子预览 6 行 / 组内格 24 行
    const leafPreview = css.slice(
      css.indexOf(".prompt-leaf-card__preview {"),
      css.indexOf("}", css.indexOf(".prompt-leaf-card__preview {")),
    );
    assert.match(leafPreview, /-webkit-line-clamp: 6;/);
    // R3：预览正文用正常正文色（非禁用灰）；pill 徽标仍保留次级色（豁免）。
    assert.match(leafPreview, /color: var\(--text\);/);
    assert.doesNotMatch(leafPreview, /text-secondary/);
    const cellBody = css.slice(
      css.indexOf(".prompt-group-cell__body {"),
      css.indexOf("}", css.indexOf(".prompt-group-cell__body {")),
    );
    assert.match(cellBody, /-webkit-line-clamp: 24;/);
    assert.match(cellBody, /color: var\(--text\);/);
    assert.doesNotMatch(cellBody, /text-secondary/);
    // workplace 文件列表卡族（无组头：轮展开即列表，用户拍板）；预览卡 6 行。
    assert.match(css, /\.prompt-workplace \{/);
    assert.match(css, /\.prompt-workplace__file \{/);
    assert.match(css, /\.prompt-workplace__preview \{/);
    const workplacePreview = css.slice(
      css.indexOf(".prompt-workplace__preview {"),
      css.indexOf("}", css.indexOf(".prompt-workplace__preview {")),
    );
    assert.match(workplacePreview, /color: var\(--text\);/);
    assert.doesNotMatch(workplacePreview, /text-secondary/);
    assert.doesNotMatch(css, /\.prompt-workplace__head \{/);
    const groupHead = css.slice(
      css.indexOf(".prompt-tool-group__head {"),
      css.indexOf("}", css.indexOf(".prompt-tool-group__head {")),
    );
    assert.match(groupHead, /min-height: 28px;/);
    // 「可点开全屏」的视觉线索：叶子卡 / 组内格要有 hover 态
    assert.match(css, /\.prompt-leaf-card:hover \{/);
    assert.match(css, /\.prompt-group-cell:hover \{/);
    assert.match(css, /\.prompt-tool-group__head:hover \{/);
    // 组卡状态文案用主题正文色（语义三色浅底对比仅 1.86~2.54:1，只留给状态点装饰）
    const groupStatus = css.slice(
      css.indexOf(".prompt-tool-group__status {"),
      css.indexOf("}", css.indexOf(".prompt-tool-group__status {")),
    );
    assert.match(groupStatus, /color: var\(--text\);/);
    // 摘要单行截断：nowrap + ellipsis
    const summary = css.slice(
      css.indexOf(".prompt-turn-card__summary {"),
      css.indexOf("}", css.indexOf(".prompt-turn-card__summary {")),
    );
    assert.match(summary, /text-overflow: ellipsis;/);
    assert.match(summary, /white-space: nowrap;/);
    assert.match(summary, /overflow: hidden;/);
    // 全屏正文容器：吃掉剩余高度并自己滚动
    const fsBody = css.slice(
      css.indexOf(".prompt-fullscreen__body {"),
      css.indexOf("}", css.indexOf(".prompt-fullscreen__body {")),
    );
    assert.match(fsBody, /flex: 1;/);
    assert.match(fsBody, /overflow-y: auto;/);
    // 原文档（固定纯文本档）+ ⤢/切换控件全族退役（用户拍板：点击就好进入全屏、
    // 全屏只保留原文）。
    assert.match(css, /\.prompt-fullscreen__raw \{/);
    assert.doesNotMatch(css, /\.prompt-fullscreen__headrow \{/);
    assert.doesNotMatch(css, /\.prompt-fullscreen__switch/);
    assert.doesNotMatch(css, /\.prompt-leaf-card__fullscreen \{/);
    assert.doesNotMatch(css, /\.prompt-group-cell__fullscreen \{/);
    assert.doesNotMatch(css, /\.prompt-turn-card__fullscreen \{/);
    // 智能体配置卡片体系对齐：子卡/格子 = blockCard 形态（1px 边 + 左 3px primary 粗条），
    // 轮卡 = surface-elevated 浮起卡（无左条），role 三态走 data-turn-kind pill。
    const leafCard = css.slice(
      css.indexOf(".prompt-leaf-card {"),
      css.indexOf("}", css.indexOf(".prompt-leaf-card {")),
    );
    assert.match(leafCard, /border-left-width: 3px;/);
    assert.match(leafCard, /border-left-color: var\(--primary\);/);
    // 子卡层沉一档（「灰→白→灰→白」明度交替，对齐智能体页观感）。
    assert.match(leafCard, /background: var\(--surface-muted\);/);
    const toolGroup = css.slice(
      css.indexOf(".prompt-tool-group {"),
      css.indexOf("}", css.indexOf(".prompt-tool-group {")),
    );
    assert.match(toolGroup, /border-left-width: 3px;/);
    assert.match(toolGroup, /border-left-color: var\(--primary\);/);
    assert.match(toolGroup, /background: var\(--surface-muted\);/);
    const groupCell = css.slice(
      css.indexOf(".prompt-group-cell {"),
      css.indexOf("}", css.indexOf(".prompt-group-cell {")),
    );
    assert.match(groupCell, /border-left-width: 3px;/);
    // 格子第三层：白底浮起（明度交替的最末一档）。
    assert.match(groupCell, /background: var\(--surface\);/);
    const turnCard = css.slice(
      css.indexOf(".prompt-turn-card {"),
      css.indexOf("}", css.indexOf(".prompt-turn-card {")),
    );
    assert.match(turnCard, /background: var\(--surface-elevated\);/);
    assert.match(turnCard, /border-radius: 16px;/);
    assert.doesNotMatch(turnCard, /border-left/);
    assert.match(css, /\.prompt-turn-card__role\[data-turn-kind="user"\] \{/);
    // assistant 与 system 共用中性底（合并选择器：assistant 行尾逗号、system 行接花括号）。
    assert.match(css, /\.prompt-turn-card__role\[data-turn-kind="assistant"\],/);
    assert.match(css, /\.prompt-turn-card__role\[data-turn-kind="system"\] \{/);
    // 展开区不再画左竖线（子卡左条负责层级表达）
    const turnBody = css.slice(
      css.indexOf(".prompt-turn-card__body {"),
      css.indexOf("}", css.indexOf(".prompt-turn-card__body {")),
    );
    assert.doesNotMatch(turnBody, /border-left/);
    // demo 紫残留清除：格头标签中性描边，全仓不再出现 violet 色板
    assert.doesNotMatch(css, /rgba\(167, ?139, ?250/);
  });
});
