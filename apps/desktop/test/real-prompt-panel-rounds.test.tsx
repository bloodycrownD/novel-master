/**
 * T-R6：desktop 提示词查看「轮聚合」渲染 + assistant 轮详情 Modal（prompt-rounds Step 10）。
 *
 * 覆盖：
 * - template / user 轮渲染原 `.prompt-segment` 卡片（user 轮多段顺序展示）；
 * - assistant 轮渲染摘要卡（role 标「assistant 轮」+ core 钉死的 summary + chevron）；
 * - 点摘要卡打开详情 Modal：内挂**只读** CodeEditor、value 即 turn.body、**不挂 onChange**；
 * - Esc 关闭 Modal（defaultPrevented 的 Esc 不拦截）；footer 关闭按钮同样关闭。
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

/** 与 core `buildPromptPreviewTurnsFromLayout` 的产出形状对齐的轮数据。 */
const TURNS: PromptPreviewTurnDto[] = [
  {
    id: "seg-sys",
    kind: "template",
    summary: "system",
    body: "你是写作助手。",
    items: [
      {
        id: "seg-sys",
        role: "system",
        title: "system",
        body: "你是写作助手。",
      },
    ],
  },
  {
    id: "seg-u1",
    kind: "user",
    summary: "user",
    body: "[#5 · user]\n帮我写第一章\n\n[#6 · user]\n三千字左右",
    items: [
      { id: "seg-u1", role: "user", title: "user", body: "帮我写第一章" },
      { id: "seg-u2", role: "user", title: "user", body: "三千字左右" },
    ],
  },
  {
    id: "seg-a1",
    kind: "assistant",
    summary: "好的，我先列提纲 · 工具调用 1 次 · 128 字",
    body: "[#7 · assistant]\n好的，我先列提纲\n\n[#8 · tool_call]\nlist_chapters",
    // payload 策略：assistant 轮 IPC 不带 items（此处刻意省略，验证消费方不依赖）。
  },
];

/** r4/B-1：非 assistant 轮 payload 不带 body（handler 只对 assistant 轮下发）。 */
const TURNS_NO_BODY: PromptPreviewTurnDto[] = [
  {
    id: "seg-sys",
    kind: "template",
    summary: "system",
    // 刻意不带 body：非 assistant 轮的 body 是 items 的前缀行拼接版，不下发。
    items: [
      {
        id: "seg-sys",
        role: "system",
        title: "system",
        body: "你是写作助手。",
      },
    ],
  },
  {
    id: "seg-u1",
    kind: "user",
    summary: "user",
    items: [
      { id: "seg-u1", role: "user", title: "user", body: "帮我写第一章" },
      { id: "seg-u2", role: "user", title: "user", body: "三千字左右" },
    ],
  },
  {
    id: "seg-a1",
    kind: "assistant",
    summary: "好的，我先列提纲 · 工具调用 1 次 · 128 字",
    body: "[#7 · assistant]\n好的，我先列提纲",
  },
];

/**
 * r4/G-1：assistant 轮**即使收到 items 也不消费**。
 *
 * handler 侧不下发，但契约要双侧锁定——handler 日后放宽、renderer 未同步时
 * 本用例必须响。
 */
const TURNS_ASSISTANT_WITH_ITEMS: PromptPreviewTurnDto[] = TURNS.map((turn) =>
  turn.kind === "assistant"
    ? {
        ...turn,
        items: [
          { id: "evil-1", role: "assistant", title: "assistant", body: "偷跑段一" },
          { id: "evil-2", role: "tool_call", title: "tool_call", body: "偷跑段二" },
        ],
      }
    : turn,
);

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

  it("template/user 轮渲染段卡片（user 轮两段顺序展示），assistant 轮渲染摘要卡", async () => {
    const renderer = await mountPanel();
    const root = renderer.root;

    // template 单段轮 + user 两段轮 → 3 张段卡片
    const segments = classNodes(root, "prompt-segment");
    assert.equal(segments.length, 3);
    assert.deepEqual(
      segments.map((node) => node.props["data-segment-id"]),
      ["seg-sys", "seg-u1", "seg-u2"],
    );

    // user 多段轮包一层轮壳，模板单段轮不加壳（形态与原卡片一致）
    const turnGroups = root.findAll((node) => hasClass(node, "prompt-turn"));
    assert.equal(turnGroups.length, 1);
    assert.equal(turnGroups[0]!.props["data-turn-id"], "seg-u1");
    assert.ok(
      turnGroups[0]!.findAll((node) => hasClass(node, "prompt-segment")).length ===
        2,
      "user 轮应包含两段",
    );

    // 段卡片 role 标签含新补的 thinking 映射所需的表（role=system 走 PROMPT_REGION_LABELS）
    assert.match(textOf(segments[0]!), /你是写作助手/);

    // assistant 轮：摘要卡 + core 钉死的 summary + chevron
    const cards = classListNodes(root, "prompt-turn-card");
    assert.equal(cards.length, 1);
    // r4/B-9：摘要卡与段卡片共用 .prompt-segment 基类，hasClass 口径下共 4 张
    assert.equal(classListNodes(root, "prompt-segment").length, 4);
    assert.equal(cards[0]!.props["data-turn-id"], "seg-a1");
    const cardText = textOf(cards[0]!);
    assert.match(cardText, /assistant 轮/);
    assert.match(cardText, /好的，我先列提纲 · 工具调用 1 次 · 128 字/);
    assert.match(textOf(cards[0]!), /▶/);
    // 未点开前没有详情 Modal
    assert.equal(classNodes(root, "text-prompt-overlay").length, 0);
  });

  it("点 assistant 轮摘要卡 → 详情 Modal 挂只读 CodeEditor（value 即 turn.body、无 onChange）", async () => {
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
    assert.equal(props[0]!["value"], TURNS[2]!.body);
    assert.equal(props[0]!["languagePath"], "prompt.txt");
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

  it("非 assistant 轮 payload 不带 body 仍正常渲染（r4/B-1）", async () => {
    const renderer = await mountPanelWith(TURNS_NO_BODY);
    const root = renderer.root;

    // template 单段 + user 两段 → 3 张段卡片，折叠摘要照常出内容
    const segments = classNodes(root, "prompt-segment");
    assert.equal(segments.length, 3);
    assert.deepEqual(
      segments.map((node) => node.props["data-segment-id"]),
      ["seg-sys", "seg-u1", "seg-u2"],
    );
    assert.match(textOf(segments[0]!), /你是写作助手/);
    assert.match(textOf(segments[1]!), /帮我写第一章/);

    // assistant 轮摘要卡照常，且详情 Modal 仍能打开（body 来自 assistant 轮）
    const cards = classListNodes(root, "prompt-turn-card");
    assert.equal(cards.length, 1);
    assert.match(textOf(cards[0]!), /好的，我先列提纲/);

    await act(async () => {
      click(firstNativeButton(cards[0]!));
    });
    const props = editorProps();
    assert.equal(props.length, 1);
    assert.equal(props[0]!["readOnly"], true);
    assert.equal(props[0]!["value"], TURNS_NO_BODY[2]!.body);
  });

  it("assistant 轮即使收到 items 也不展开（r4/G-1）", async () => {
    const renderer = await mountPanelWith(TURNS_ASSISTANT_WITH_ITEMS);
    const root = renderer.root;

    // 仍只出 1 张摘要卡
    assert.equal(classListNodes(root, "prompt-turn-card").length, 1);
    // .prompt-segment 计数与基线一致（3 段卡片 + 1 摘要卡），未被 items 撑大
    assert.equal(classListNodes(root, "prompt-segment").length, 4);
    // 偷跑的段一条都没渲染出来
    assert.equal(
      root.findAll((node) => node.props?.["data-segment-id"] === "evil-1").length,
      0,
    );
    assert.equal(
      root.findAll((node) => node.props?.["data-segment-id"] === "evil-2").length,
      0,
    );
    assert.doesNotMatch(renderer.toJSON() ? JSON.stringify(renderer.toJSON()) : "", /偷跑段/);
  });
});

describe("T-R6 契约层：payload 策略 / CodeEditor readOnly / 样式", () => {
  it("handler map：assistant 轮不下发 items（长会话 payload 不翻倍）", () => {
    const src = readFileSync(
      join(desktopRoot, "src", "main", "ipc", "handlers", "prompt.ts"),
      "utf8",
    );
    // 轮 DTO 返回类型
    assert.match(src, /IpcResult<PromptPreviewTurnDto\[\]>/);
    assert.match(src, /buildRealPromptPreviewTurns/);
    // assistant 轮走空扩展分支（不带 items），其余轮带 items
    assert.match(
      src,
      /turn\.kind === "assistant"\s*\?\s*\{\}\s*:\s*\{\s*items:/,
    );
    // r4/B-1：body 只对 assistant 轮下发（独立展开叠加，不并进上面那个三元）
    assert.match(
      src,
      /turn\.kind === "assistant" \? \{ body: turn\.body \} : \{\}/,
    );
    assert.doesNotMatch(src, /^\s*body: turn\.body,$/m);
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
    // 段级截断只服务 template/user 轮卡片；assistant 轮摘要直用 core 口径（不二次加工）
    assert.match(src, /turn\.summary/);
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
