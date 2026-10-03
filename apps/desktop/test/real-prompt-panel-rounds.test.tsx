/**
 * T-R6 / T-DP1~T-DP5：desktop 提示词查看「三层结构」UI（prompt-preview-ui-redesign Step6）。
 *
 * 覆盖：
 * - 轮卡列表：三类轮统一形态（role 徽标 + summaryText 单行截断 + metaText 行 + ⤢ 整轮全屏），
 *   点头部就地展开/收起（展开区渲染 `turn.cards`）；
 * - 展开区的叶子卡（text / thinking，kind 标签 + 限 2 行预览）与工具组卡
 *   （组头状态点三态 + 可选「并行」徽标 + use/result 两格，悬挂时「未返回结果」占位）；
 * - 全屏 Modal：正文容器 `.prompt-fullscreen__body` 内跑 **MermaidMarkdown**（只读、
 *   不接 onLinkClick）；Esc（defaultPrevented 不拦截）/ 遮罩 / footer 三条关闭路径；
 * - 退役字段（`body` / `items`）即便残留在 payload 里也不参与渲染。
 *
 * 范式对齐 fetch-models-modal.test.tsx / chat-search-race-guard.test.tsx：
 * react-alias-hook.mjs 统一根 react 副本，react-test-renderer 真渲面板；
 * IPC 拦在 window.novelMasterDesktop.invoke（ipc client 底层出口）。
 * 两处替身说明：
 * - MermaidMarkdown 经 prompt-turn-mermaid-hook.mjs 重定向到 stub（真组件依赖
 *   documentElement / MutationObserver，node 环境下跑不动），content 断言落在 props 形状上，
 *   MermaidMarkdown 自身行为由 mermaid-markdown.test.tsx 覆盖；
 * - node 环境无 document，Modal 的 Esc 监听用最小 document 桩驱动。
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
register(new URL("./prompt-turn-mermaid-hook.mjs", import.meta.url));
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
    kind: "template",
    summaryText: "system",
    metaText: "6 字",
    cards: [
      // template 轮的卡片 id 沿用段 id（core 侧同口径）。
      { type: "text", id: "seg-sys", role: "system", body: "你是写作助手。" },
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
        result: { toolUseId: "call-ok", ok: true, body: "目录已返回" },
        status: "ok",
        parallel: true,
      },
      {
        type: "toolGroup",
        id: "group-error",
        toolName: "read_chapter",
        inputJson: '[tool_use name=read_chapter id=call-err]',
        result: { toolUseId: "call-err", ok: false, body: "Error: 章不存在" },
        status: "error",
        parallel: false,
      },
      {
        type: "toolGroup",
        id: "group-lost",
        toolName: "write_chapter",
        inputJson: '[tool_use name=write_chapter id=call-lost]',
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

/** 挂全局 window.novelMasterDesktop + document 桩，返回还原函数。 */
function installGlobals(turns: PromptPreviewTurnDto[]): {
  restore: () => void;
  doc: DocumentStub;
} {
  const g = globalThis as unknown as {
    window?: unknown;
    document?: unknown;
    IS_REACT_ACT_ENVIRONMENT?: boolean;
    __promptTurnMermaidProps?: Record<string, unknown>[];
  };
  const prevWindow = g.window;
  const prevDocument = g.document;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  const prevMermaidProps = g.__promptTurnMermaidProps;
  const doc = makeDocumentStub();
  g.window = {
    novelMasterDesktop: {
      invoke: (channel: string) => {
        if (channel === "nm:prompt/realPreview") {
          return Promise.resolve({ ok: true, data: turns });
        }
        return Promise.reject(new Error(`测试未预期的 IPC channel: ${channel}`));
      },
    },
  };
  g.document = doc;
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.__promptTurnMermaidProps = [];
  return {
    doc,
    restore: () => {
      g.window = prevWindow;
      g.document = prevDocument;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      g.__promptTurnMermaidProps = prevMermaidProps;
    },
  };
}

/** stub 记下的 MermaidMarkdown props 序列（每次渲染 push 一份）。 */
function mermaidProps(): Record<string, unknown>[] {
  return (
    (globalThis as unknown as { __promptTurnMermaidProps?: Record<string, unknown>[] })
      .__promptTurnMermaidProps ?? []
  );
}

/** 清空记录序列，用于「第二次全屏」的断言起点（stub 只 push 不重置）。 */
function resetMermaidProps(): void {
  (globalThis as unknown as { __promptTurnMermaidProps?: Record<string, unknown>[] })
    .__promptTurnMermaidProps = [];
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

/** 用指定轮数据挂载面板（覆盖 beforeEach 装好的默认 IPC 返回体）。 */
async function mountPanelWith(
  turns: PromptPreviewTurnDto[],
): Promise<ReactTestRenderer> {
  const installed = installGlobals(turns);
  try {
    return await mountPanel();
  } finally {
    installed.restore();
  }
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

  beforeEach(() => {
    const installed = installGlobals(TURNS);
    restore = installed.restore;
    doc = installed.doc;
  });

  afterEach(() => {
    restore();
  });

  it("T-DP1：template / user / assistant 三类轮统一渲染成轮摘要卡（徽标+单行摘要+meta 行+⤢）", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;

    // 三类轮 = 三张轮卡，data-turn-kind 一并钉住
    const turnCards = classListNodes(root, "prompt-turn-card");
    assert.equal(turnCards.length, 3);
    assert.deepEqual(
      turnCards.map((node) => node.props["data-turn-id"]),
      ["seg-sys", "turn-5", "turn-7"],
    );
    assert.deepEqual(
      turnCards.map((node) => node.props["data-turn-kind"]),
      ["template", "user", "assistant"],
    );
    // 每张轮卡都同时挂轮壳类与 kind 修饰类（三类统一外壳，只靠色条/徽标区分）
    for (const turnCard of turnCards) {
      assert.ok(hasClass(turnCard, "prompt-turn"), "轮卡应挂 .prompt-turn 轮壳类");
    }
    assert.equal(classListNodes(root, "prompt-turn--template").length, 1);
    assert.equal(classListNodes(root, "prompt-turn--user").length, 1);
    assert.equal(classListNodes(root, "prompt-turn--assistant").length, 1);

    // role 徽标：user 青 / assistant 紫 / template 灰（语义色，对齐设计基准 demo）
    const roles = classListNodes(root, "prompt-turn-card__role");
    assert.deepEqual(
      roles.map((node) => textOf(node)),
      ["template", "user", "assistant"],
    );
    assert.deepEqual(
      roles.map((node) => (node.props as { style: { color: string } }).style.color),
      ["var(--text-tertiary)", "var(--primary)", "var(--text-secondary)"],
    );

    // summaryText 单行摘要 + metaText 计数行（摘要不二次加工，直接读 core 字段）
    const summaries = classListNodes(root, "prompt-turn-card__summary");
    assert.deepEqual(
      summaries.map((node) => textOf(node)),
      ["system", "帮我写第一章", "好的，我先列提纲"],
    );
    const metas = classListNodes(root, "prompt-turn-card__meta");
    assert.deepEqual(
      metas.map((node) => textOf(node)),
      ["6 字", "#5 · 15 字", "#7 · 工具调用 1 次 · 128 字"],
    );
    // meta 行同时挂 .prompt-segment__preview（契约类名保留）
    for (const meta of metas) {
      assert.ok(hasClass(meta, "prompt-segment__preview"));
    }

    // 每轮一个整轮全屏按钮 ⤢ + 一个 chevron
    assert.equal(classListNodes(root, "prompt-turn-card__fullscreen").length, 3);
    assert.match(
      textOf(classListNodes(root, "prompt-turn-card__fullscreen")[0]!),
      /⤢/,
    );
    assert.equal(classListNodes(root, "prompt-turn-card__body").length, 0);
    // 默认收起：没有展开区、没有卡片、没有 Modal
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
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
    // 叶子卡：kind 标签 + 预览正文（限行由 CSS 承担，见 T-DP5）
    assert.deepEqual(
      leafCards.map((node) => textOf(node.findAll(
        (n) => n.props?.className === "prompt-leaf-card__kind",
      )[0]!)),
      ["user", "user"],
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
    const renderer = await mountPanelWith(TURNS_GROUP_STATES);
    const root = renderer.root;
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

  it("T-DP3：⤢ 整轮全屏 → Modal 正文容器跑 MermaidMarkdown，cards 逐卡成流且不挂 onLinkClick", async () => {
    const renderer = await mountPanelWith(TURNS_FULLSCREEN);
    const root = renderer.root;

    await act(async () => {
      click(
        classListNodes(root, "prompt-turn-card")[0]!.findAll(
          (n) => n.props?.className === "prompt-turn-card__fullscreen",
        )[0]!,
      );
    });

    const overlays = classNodes(root, "text-prompt-overlay");
    assert.equal(overlays.length, 1);
    const modal = root.findAll((node) => node.props?.role === "dialog")[0]!;
    assert.equal(modal.props["aria-modal"], "true");
    assert.match(String(modal.props["aria-label"]), /assistant · 全屏流夹具详情/);
    // 壳复用：.text-prompt-overlay / .prompt-editor-modal / footer 全在
    assert.equal(
      modal.findAll(
        (node) => node.props?.className === "prompt-editor-modal__footer",
      ).length,
      1,
    );
    // 正文容器是新增的 .prompt-fullscreen__body（flex:1 + overflow-y:auto 由 CSS 保证）
    const body = modal.findAll(
      (node) => node.props?.className === "prompt-fullscreen__body",
    )[0]!;

    // 整轮 = cards 逐卡富文本流：叶子正文 1 段 + 组卡两格 2 段，无 [段名] 前缀
    const props = mermaidProps();
    assert.equal(props.length, 3);
    assert.deepEqual(
      props.map((p) => p["content"]),
      [
        "先列提纲",
        '[tool_use name=read_chapter id=call-2]',
        "未返回结果",
      ],
    );
    // 只读预览：链接路由回调不传
    for (const p of props) {
      assert.equal(p["onLinkClick"], undefined, "只读全屏不应挂 onLinkClick");
    }
    // 三段都落在正文容器里（stub 渲染 data-mermaid-stub 占位节点）
    const stubs = body.findAll(
      (node) => node.props?.["data-mermaid-stub"] === "true",
    );
    assert.equal(stubs.length, 3);
    // 逐卡富文本流之间无 `[段名]` 前缀，只有视觉分隔块
    assert.equal(
      body.findAll((node) => node.props?.className === "prompt-fullscreen__block")
        .length,
      3,
    );
    assert.equal(
      textOf(body).includes("["),
      false,
      "正文容器不应拼出 [段名] 式前缀",
    );
    // CodeEditor 已从本面板退役
    assert.equal(
      (globalThis as unknown as { __promptTurnCodeEditorProps?: unknown[] })
        .__promptTurnCodeEditorProps?.length ?? 0,
      0,
      "面板不应再挂 CodeEditor",
    );
  });

  it("T-DP3：全屏 Modal 渲染/原文切换——原文档铺 pre 原文、渲染档回 MermaidMarkdown", async () => {
    const renderer = await mountPanelWith(TURNS_FULLSCREEN);
    const root = renderer.root;
    await act(async () => {
      click(
        classListNodes(root, "prompt-turn-card")[0]!.findAll(
          (n) => n.props?.className === "prompt-turn-card__fullscreen",
        )[0]!,
      );
    });
    // 初始渲染档：MermaidMarkdown 三段、无原文 pre。
    assert.equal(mermaidProps().length, 3);
    assert.equal(classListNodes(root, "prompt-fullscreen__raw").length, 0);

    // 切「原文」：逐块 pre 铺开原文（大段 tool JSON 不再被富文本管线吃掉格式），
    // Mermaid 不再渲染。
    resetMermaidProps();
    await act(async () => {
      click(
        classListNodes(root, "prompt-fullscreen__switch-btn").find((n) =>
          textOf(n) === "原文",
        )!,
      );
    });
    assert.equal(mermaidProps().length, 0, "原文档不应再跑富文本管线");
    const raws = classListNodes(root, "prompt-fullscreen__raw");
    assert.equal(raws.length, 3);
    assert.deepEqual(
      raws.map((n) => textOf(n)),
      ["先列提纲", "[tool_use name=read_chapter id=call-2]", "未返回结果"],
    );

    // 切回「渲染」：pre 消失、Mermaid 回来。
    await act(async () => {
      click(
        classListNodes(root, "prompt-fullscreen__switch-btn").find((n) =>
          textOf(n) === "渲染",
        )!,
      );
    });
    assert.equal(classListNodes(root, "prompt-fullscreen__raw").length, 0);
    assert.equal(mermaidProps().length, 3);
  });

  it("T-DP3：叶子卡与组卡格子都有显式 ⤢ 入口（悬挂 result 格不出）", async () => {
    // 默认夹具（ok 组卡）：assistant 轮 = 1 叶子 + 组卡两格，⤢ 各一。
    const renderer = await mountPanel();
    const root = renderer.root;
    await expandTurn(root, "turn-7");
    await act(async () => {
      click(classNodes(root, "prompt-tool-group__head")[0]!);
    });
    assert.equal(classListNodes(root, "prompt-leaf-card__fullscreen").length, 1);
    assert.equal(classListNodes(root, "prompt-group-cell__fullscreen").length, 2);

    // 悬挂夹具：组卡 use 格 ⤢ 在、result 格不出（假入口不留）。
    const lost = await mountPanelWith(TURNS_FULLSCREEN);
    const lroot = lost.root;
    await expandTurn(lroot, "turn-13");
    await act(async () => {
      click(classNodes(lroot, "prompt-tool-group__head")[0]!);
    });
    assert.equal(
      classListNodes(lroot, "prompt-group-cell__fullscreen").length,
      1,
      "悬挂 result 格不应出 ⤢",
    );
    // 悬挂夹具的叶子卡 ⤢ 仍在。
    assert.equal(classListNodes(lroot, "prompt-leaf-card__fullscreen").length, 1);
  });

  it("T-DP3：叶子卡与组卡格子各自点开全屏（单份正文），⤢ 之外互不串台", async () => {
    const renderer = await mountPanelWith(TURNS_GROUP_STATES);
    const root = renderer.root;
    await expandTurn(root, "turn-11");

    // 叶子卡（thinking）→ 全屏正文就是该卡 body
    await act(async () => {
      click(classListNodes(root, "prompt-leaf-card")[0]!);
    });
    assert.deepEqual(
      mermaidProps().map((p) => p["content"]),
      ["（思考正文）"],
    );
    const title = classNodes(root, "prompt-fullscreen__title")[0]!;
    assert.equal(textOf(title), "thinking");
    // 先关掉，避免与下一段串台；stub 只 push 不重置，记录也一并清零
    await act(async () => {
      click(classNodes(root, "text-prompt-overlay")[0]!);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
    resetMermaidProps();

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
    assert.deepEqual(
      mermaidProps().map((p) => p["content"]),
      ["Error: 章不存在"],
    );
    assert.equal(textOf(classNodes(root, "prompt-fullscreen__title")[0]!), "tool result");
  });

  it("Esc 关闭全屏 Modal；defaultPrevented 的 Esc 不拦截", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    await act(async () => {
      click(
        classListNodes(root, "prompt-turn-card")[2]!.findAll(
          (n) => n.props?.className === "prompt-turn-card__fullscreen",
        )[0]!,
      );
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
      await act(async () => {
        click(
          classListNodes(root, "prompt-turn-card")[2]!.findAll(
            (n) => n.props?.className === "prompt-turn-card__fullscreen",
          )[0]!,
        );
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

  it("整轮全屏正文只由 cards 拼出（thinking / 文本 / 丢失工具组三态，不依赖旧 body）", async () => {
    const renderer = await mountPanelWith(TURNS_GROUP_STATES);
    const root = renderer.root;

    await act(async () => {
      click(
        classListNodes(root, "prompt-turn-card")[0]!.findAll(
          (n) => n.props?.className === "prompt-turn-card__fullscreen",
        )[0]!,
      );
    });

    // 逐卡成流：thinking 正文、文本正文、组卡两格入参/结果
    assert.deepEqual(
      mermaidProps().map((p) => p["content"]),
      [
        "（思考正文）",
        '{ "limit": 3 }',
        "目录已返回",
        "[tool_use name=read_chapter id=call-err]",
        "Error: 章不存在",
        "[tool_use name=write_chapter id=call-lost]",
        "未返回结果",
      ],
    );
  });

  it("退役字段 body / items 即使残留在 payload 里也不参与渲染（双侧锁定）", async () => {
    const renderer = await mountPanelWith(TURNS_WITH_LEGACY_FIELDS);
    const root = renderer.root;

    // 轮卡列表条数与基线一致（3 轮 → 3 张卡），未被 items 撑大
    assert.equal(classListNodes(root, "prompt-turn-card").length, 3);
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
    const renderer = await mountPanelWith(TURNS_WITHOUT_CARDS);
    const root = renderer.root;

    // 三张轮卡照常出（摘要/meta 行不依赖 cards）
    assert.equal(classListNodes(root, "prompt-turn-card").length, 3);
    assert.deepEqual(
      classListNodes(root, "prompt-turn-card__summary").map((node) => textOf(node)),
      ["system", "帮我写第一章", "好的，我先列提纲"],
    );

    // 展开轮卡：展开区挂载了，但一张卡都没有（cards 被归一化成空数组）
    await expandTurn(root, "turn-7");
    assert.equal(classListNodes(root, "prompt-turn-card__body").length, 1);
    assert.equal(classListNodes(root, "prompt-leaf-card").length, 0);
    assert.equal(classListNodes(root, "prompt-tool-group").length, 0);

    // ⤢ 整轮全屏同样不炸（另一处裸读 cards 的地方），正文走空占位
    await act(async () => {
      click(
        classListNodes(root, "prompt-turn-card")[0]!.findAll(
          (n) => n.props?.className === "prompt-turn-card__fullscreen",
        )[0]!,
      );
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 1);
    assert.equal(
      classListNodes(root, "prompt-fullscreen__empty").length,
      1,
    );
    assert.equal(mermaidProps().length, 0);
  });

  it("切会话（sessionId 变）→ 展开态与整轮全屏一并清空，不带到下一会话", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;

    // 先把 user 轮展开 + 打开 ⤢ 全屏，两个临时态都挂上
    await expandTurn(root, "turn-5");
    await act(async () => {
      click(
        classListNodes(root, "prompt-turn-card")[0]!.findAll(
          (n) => n.props?.className === "prompt-turn-card__fullscreen",
        )[0]!,
      );
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

  it("J-1：读屏标签带内容——叶子卡带 kind+正文，轮卡 toggle / ⤢ 带 role+摘要", async () => {
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

    // ⤢ 整轮全屏：带 role 与摘要（不再三个轮卡都只念「整轮全屏」）
    assert.deepEqual(
      classListNodes(root, "prompt-turn-card__fullscreen").map(ariaLabelOf),
      [
        "整轮全屏，template system",
        "整轮全屏，user 帮我写第一章",
        "整轮全屏，assistant 好的，我先列提纲",
      ],
    );
  });

  it("J-1：组卡两格的读屏标签带工具名（同名工具的两格也分得开）", async () => {
    const renderer = await mountPanelWith(TURNS_GROUP_STATES);
    const root = renderer.root;
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
    assert.match(src, /export type PromptTurnCardDto = PromptTextCardDto \| PromptToolGroupDto;/);
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

  it("RealPromptPanel：三层结构源码契约（轮卡 + 组卡/叶子卡 + Modal 跑 MermaidMarkdown）", () => {
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
    // 正文容器新增 .prompt-fullscreen__body，内挂 MermaidMarkdown（只读，不接 onLinkClick）
    assert.match(code, /className="prompt-fullscreen__body"/);
    assert.match(code, /<MermaidMarkdown content=\{content\} \/>/);
    assert.doesNotMatch(code, /onLinkClick/);
    // 轮卡读 core 钉死的 summaryText / metaText（旧 summary 拼串已退役），不再二次加工
    assert.match(code, /turn\.summaryText/);
    assert.match(code, /turn\.metaText/);
    // 轮卡列表 + 展开态受控 map（轮 key = turn.id，组卡 key = turn.id + card.id）
    assert.match(code, /className=\{`prompt-turn prompt-turn--\$\{turn\.kind\}/);
    assert.match(code, /expanded\[`\$\{turnId\}::\$\{card\.id\}`\]/);
    // 组卡 toggle 写入侧与读取侧同 key（否则展开态写进去读不出来）
    assert.match(code, /onToggle=\{\(cardId\) => toggleExpanded\(`\$\{turnId\}::\$\{cardId\}`\)\}/);
    // 轮层 role 徽标三色 + 标签（对齐设计基准 demo）
    assert.match(code, /user: "var\(--primary\)"/);
    assert.match(code, /assistant: "var\(--text-secondary\)"/);
    assert.match(code, /template: "var\(--text-tertiary\)"/);
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
    // 新增：叶子卡（限 2 行预览）+ 工具组卡 + 组内两格 + 全屏正文容器
    assert.match(css, /\.prompt-leaf-card \{/);
    assert.match(css, /\.prompt-leaf-card__preview \{/);
    assert.match(css, /\.prompt-tool-group \{/);
    assert.match(css, /\.prompt-group-cell \{/);
    assert.match(css, /\.prompt-fullscreen__body \{/);
    // 限行口径：叶子预览 2 行 / 组内格 3 行
    const leafPreview = css.slice(
      css.indexOf(".prompt-leaf-card__preview {"),
      css.indexOf("}", css.indexOf(".prompt-leaf-card__preview {")),
    );
    assert.match(leafPreview, /-webkit-line-clamp: 2;/);
    const cellBody = css.slice(
      css.indexOf(".prompt-group-cell__body {"),
      css.indexOf("}", css.indexOf(".prompt-group-cell__body {")),
    );
    assert.match(cellBody, /-webkit-line-clamp: 3;/);
    // 「可点开全屏」的视觉线索：叶子卡 / 组内格 / ⤢ 按钮都要有 hover 态
    assert.match(css, /\.prompt-leaf-card:hover \{/);
    assert.match(css, /\.prompt-group-cell:hover \{/);
    assert.match(css, /\.prompt-turn-card__fullscreen:hover \{/);
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
    // 显式 ⤢ 入口 + Modal 切换控件 + 原文档（真机反馈三件套）
    assert.match(css, /\.prompt-fullscreen__headrow \{/);
    assert.match(css, /\.prompt-fullscreen__switch-btn \{/);
    assert.match(css, /\.prompt-fullscreen__raw \{/);
    assert.match(css, /\.prompt-leaf-card__fullscreen \{/);
    assert.match(css, /\.prompt-group-cell__fullscreen \{/);
    // 展开区嵌套左线（mobile 同款层次表达）
    const turnBody = css.slice(
      css.indexOf(".prompt-turn-card__body {"),
      css.indexOf("}", css.indexOf(".prompt-turn-card__body {")),
    );
    assert.match(turnBody, /border-left: 2px solid var\(--border-light\);/);
    // demo 紫残留清除：格头标签中性描边，全仓不再出现 violet 色板
    assert.doesNotMatch(css, /rgba\(167, ?139, ?250/);
  });
});
