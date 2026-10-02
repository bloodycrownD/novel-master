/**
 * T-R6：desktop 提示词查看「轮聚合」渲染 + assistant 轮详情 Modal（prompt-rounds Step 10）。
 *
 * 覆盖：
 * - template / user 轮渲染 `cards` 驱动的 `.prompt-segment` 折叠卡片（多卡轮包一层轮壳）；
 * - assistant 轮渲染摘要卡（role 标「assistant 轮」+ core 钉死的 summaryText + chevron）；
 * - 点摘要卡打开详情 Modal：内挂**只读** CodeEditor、value 由 `cards` 逐卡拼出、**不挂 onChange**；
 * - Esc 关闭 Modal（defaultPrevented 的 Esc 不拦截）；footer 关闭按钮同样关闭；
 * - 退役字段（`body` / `items`）即便残留在 payload 里也不参与渲染。
 *
 * 范式对齐 fetch-models-modal.test.tsx / chat-search-race-guard.test.tsx：
 * react-alias-hook.mjs 统一根 react 副本，react-test-renderer 真渲面板；
 * IPC 拦在 window.novelMasterDesktop.invoke（ipc client 底层出口）。
 * 两处替身说明：
 * - CodeEditor 经 prompt-turn-code-editor-hook.mjs 重定向到 stub（真组件需要 DOM），
 *   只读语义断言落在 props 形状上，CodeEditor 自身实现由文末源码级断言兜底；
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
register(new URL("./prompt-turn-code-editor-hook.mjs", import.meta.url));
const { act } = await import("react");
const { RealPromptPanel } = await import("@/features/chat/RealPromptPanel");

/**
 * 与 core `buildPromptPreviewTurnsFromLayout` 的新 payload 形态对齐：
 * `cards` 是唯一正文载体，`body` / `items` / `summary` 均已从 DTO 退役。
 *
 * ⚠️ user 轮给两张卡是**合成夹具**：core 的 user 轮实为「wrap 后整条文本直转单卡」，
 * 这里造第二张卡只为继续覆盖面板的 `.prompt-turn` 轮壳分支（core 侧覆盖见 T-PT5）。
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
 * cards 驱动的详情正文夹具：assistant 轮带 thinking 卡 + 文本卡，
 * 用来验证详情 Modal 的 value 由 `cards` 逐卡拼出（旧的 `turn.body` 已退役）。
 */
const TURNS_CARDS_ONLY: PromptPreviewTurnDto[] = [
  {
    id: "turn-9",
    kind: "assistant",
    summaryText: "先列提纲",
    metaText: "#9 · 20 字",
    cards: [
      { type: "thinking", id: "card-t1", role: "assistant", body: "（思考正文）" },
      { type: "text", id: "card-a2", role: "assistant", body: "先列提纲" },
      {
        type: "toolGroup",
        id: "group-call-2",
        toolName: "read_chapter",
        inputJson: "[tool_use name=read_chapter id=call-2]",
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
    __promptTurnCodeEditorProps?: Record<string, unknown>[];
  };
  const prevWindow = g.window;
  const prevDocument = g.document;
  const prevActEnv = g.IS_REACT_ACT_ENVIRONMENT;
  const prevEditorProps = g.__promptTurnCodeEditorProps;
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
  g.__promptTurnCodeEditorProps = [];
  return {
    doc,
    restore: () => {
      g.window = prevWindow;
      g.document = prevDocument;
      g.IS_REACT_ACT_ENVIRONMENT = prevActEnv;
      g.__promptTurnCodeEditorProps = prevEditorProps;
    },
  };
}

function editorProps(): Record<string, unknown>[] {
  return (
    (globalThis as unknown as { __promptTurnCodeEditorProps?: Record<string, unknown>[] })
      .__promptTurnCodeEditorProps ?? []
  );
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
 * r4/B-9 起 assistant 轮摘要卡同时挂 `prompt-segment prompt-turn-card` 两类，
 * 断言这两类都得走本helper，全等口径会把 assistant 卡漏掉。
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

/** 取节点子树里第一个原生 button（摘要卡 / footer 按钮都是原生 button）。 */
function firstNativeButton(node: {
  findAll: (p: (n: { type: unknown }) => boolean) => Array<{ props: unknown }>;
}): { props: unknown } {
  return node.findAll((n) => typeof n.type === "string" && n.type === "button")[0]!;
}

describe("RealPromptPanel 轮渲染 + assistant 轮详情 Modal (T-R6)", () => {
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

  it("template/user 轮渲染 cards 卡片（多卡轮包轮壳），assistant 轮渲染摘要卡", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;

    // template 单卡轮 + user 两卡轮 → 3 张卡片，data-card-id 即 core 的卡片 id
    const segments = classNodes(root, "prompt-segment");
    assert.equal(segments.length, 3);
    assert.deepEqual(
      segments.map((node) => node.props["data-card-id"]),
      ["seg-sys", "card-u1", "card-u2"],
    );

    // 多卡轮包一层轮壳，单卡轮不加壳（形态与单张卡片一致）
    const turnGroups = root.findAll((node) => hasClass(node, "prompt-turn"));
    assert.equal(turnGroups.length, 1);
    assert.equal(turnGroups[0]!.props["data-turn-id"], "turn-5");
    assert.ok(
      turnGroups[0]!.findAll((node) => hasClass(node, "prompt-segment")).length ===
        2,
      "user 轮应包含两张卡片",
    );

    // 卡片 role 标签走 ROLE_LABELS 映射表（system 走 PROMPT_REGION_LABELS）
    assert.match(textOf(segments[0]!), /你是写作助手/);

    // assistant 轮：摘要卡 + core 钉死的 summaryText + chevron
    const cards = classListNodes(root, "prompt-turn-card");
    assert.equal(cards.length, 1);
    // 摘要卡与卡片共用 .prompt-segment 基类，hasClass 口径下共 4 张
    assert.equal(classListNodes(root, "prompt-segment").length, 4);
    assert.equal(cards[0]!.props["data-turn-id"], "turn-7");
    const cardText = textOf(cards[0]!);
    assert.match(cardText, /assistant 轮/);
    assert.match(cardText, /好的，我先列提纲/);
    assert.doesNotMatch(cardText, /工具调用 1 次/);
    assert.match(textOf(cards[0]!), /▶/);
    // 未点开前没有详情 Modal
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
  });

  it("点 assistant 轮摘要卡 → 详情 Modal 挂只读 CodeEditor（value 由 cards 逐卡拼出、无 onChange）", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    const card = classListNodes(root, "prompt-turn-card")[0]!;
    const button = firstNativeButton(card);

    await act(async () => {
      click(button);
    });

    const overlays = classNodes(root, "text-prompt-overlay");
    assert.equal(overlays.length, 1);
    const modal = root.findAll((node) => node.props?.role === "dialog")[0]!;
    assert.equal(modal.props["aria-modal"], "true");
    assert.match(String(modal.props["aria-label"]), /assistant 轮详情/);

    const props = editorProps();
    assert.equal(props.length, 1);
    assert.equal(props[0]!["readOnly"], true);
    assert.equal(props[0]!["languagePath"], "prompt.txt");
    // 正文载体只有 cards：每张卡的正文（工具组卡取 use 输入 + result）都要进详情
    const value = String(props[0]!["value"]);
    for (const card of TURNS[2]!.cards) {
      if (card.type === "toolGroup") {
        assert.ok(value.includes(card.inputJson), "详情应含工具输入");
        assert.ok(value.includes(card.result?.body ?? ""), "详情应含工具结果");
      } else {
        assert.ok(value.includes(card.body), "详情应含卡片正文");
      }
    }
    assert.equal(
      props[0]!["onChange"],
      undefined,
      "只读详情不应挂 onChange（内容永不回写）",
    );
    assert.equal(
      props[0]!["onSave"],
      undefined,
      "只读详情不提供保存动作",
    );
  });

  it("Esc 关闭详情 Modal；defaultPrevented 的 Esc 不拦截", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    const button = firstNativeButton(classListNodes(root, "prompt-turn-card")[0]!);

    await act(async () => {
      click(button);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 1);

    // 已被 CodeEditor 等消费掉的 Esc（defaultPrevented）不关闭
    await act(async () => {
      doc.press("Escape", true);
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 1);

    await act(async () => {
      doc.press("Escape");
    });
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
  });

  it("footer 关闭按钮关闭详情 Modal（点遮罩同样关闭）", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;
    const openDetail = async () => {
      const button = firstNativeButton(classListNodes(root, "prompt-turn-card")[0]!);
      await act(async () => {
        click(button);
      });
    };

    await openDetail();
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
    await openDetail();
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

  it("payload 无 body 时详情正文仍由 cards 拼出（thinking / 文本 / 丢失工具组三态）", async () => {
    const renderer = await mountPanelWith(TURNS_CARDS_ONLY);
    const root = renderer.root;

    // assistant 轮：只有一张摘要卡，卡片流不在轮列表里平铺
    const cards = classListNodes(root, "prompt-turn-card");
    assert.equal(cards.length, 1);
    assert.equal(classListNodes(root, "prompt-segment").length, 1);
    assert.match(textOf(cards[0]!), /先列提纲/);

    await act(async () => {
      click(firstNativeButton(cards[0]!));
    });

    const props = editorProps();
    assert.equal(props.length, 1);
    assert.equal(props[0]!["readOnly"], true);
    const value = String(props[0]!["value"]);
    // thinking 卡正文进详情
    assert.match(value, /（思考正文）/);
    // 文本卡正文进详情
    assert.match(value, /先列提纲/);
    // 悬挂工具组卡：use 输入进详情，result 为 null 时出占位文案
    assert.match(value, /\[tool_use name=read_chapter id=call-2\]/);
    assert.match(value, /（未返回结果）/);
  });

  it("退役字段 body / items 即使残留在 payload 里也不参与渲染（双侧锁定）", async () => {
    const renderer = await mountPanelWith(TURNS_WITH_LEGACY_FIELDS);
    const root = renderer.root;

    // 仍只出 1 张摘要卡
    assert.equal(classListNodes(root, "prompt-turn-card").length, 1);
    // .prompt-segment 计数与基线一致（3 张卡片 + 1 摘要卡），未被 items 撑大
    assert.equal(classListNodes(root, "prompt-segment").length, 4);
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

  it("RealPromptPanel：ROLE_LABELS 补 thinking；Modal 套 .text-prompt-overlay + .prompt-editor-modal", () => {
    const src = readFileSync(
      join(rendererRoot, "features", "chat", "RealPromptPanel.tsx"),
      "utf8",
    );
    assert.match(src, /thinking: "思考"/);
    assert.match(src, /className="text-prompt-overlay"/);
    assert.match(src, /className="prompt-editor-modal"/);
    assert.match(src, /className="prompt-editor-modal__footer"/);
    assert.match(src, /languagePath="prompt\.txt"/);
    // 摘要读 core 钉死的 summaryText（旧 summary 拼串已退役），不再二次加工
    assert.match(src, /turn\.summaryText/);
    // 详情正文由 cards 逐卡拼出（body 已退役）
    assert.match(src, /cardsToDetailText\(detailTurn\.cards\)/);
  });

  it("shell.css：新增 assistant 轮卡片与轮壳样式", () => {
    const css = readFileSync(join(rendererRoot, "styles", "shell.css"), "utf8");
    assert.match(css, /\.prompt-turn-card \{/);
    assert.match(css, /\.prompt-turn \{/);
    assert.match(css, /\.prompt-turn-card \.prompt-segment__preview \{/);
    // r4/B-9：hover 基线补在 .prompt-segment 上，.prompt-turn-card 不再自带 box/hover
    assert.match(css, /\.prompt-segment:hover \{/);
    assert.doesNotMatch(css, /\.prompt-turn-card:hover \{/);
  });
});
