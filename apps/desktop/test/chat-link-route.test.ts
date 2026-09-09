/**
 * T-L6（chat-link-file-nav）：desktop 聊天链接路由测试。
 *
 * - 第一段：chat-link-route 纯函数直测（node:test，mock ipcVfsRead 的
 *   ok / NOT_FOUND 两态；探测顺序 chat 域→session 域；一切非 ok 按未命中）。
 * - 第二段：源码契约——main.ts 主进程拦截与 MessageList 流式尾巴消费点
 *   接线跨 Electron/React 边界，按仓库静态/源码双轨模式断言。
 * 命名陷阱双钉：workspaceScope "chat"=core session 域、"session"=core
 * project 域（PreviewPane.toCoreVfsScope 同口径），断言里显式验证。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveChatLinkAction,
  type ChatLinkProbeRead,
} from "@/features/chat/chat-link-route";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");

function readSrc(...parts: string[]): string {
  return readFileSync(path.join(desktopRoot, ...parts), "utf8");
}

/** ipcVfsRead stub：按 workspaceScope+path 分派 ok / 非 ok。 */
function makeVfsRead(
  table: Record<string, "ok" | "NOT_FOUND" | "IS_DIRECTORY">,
): ChatLinkProbeRead & { calls: Array<{ workspaceScope: string; path: string }> } {
  const calls: Array<{ workspaceScope: string; path: string }> = [];
  const impl: ChatLinkProbeRead = async (req) => {
    calls.push({ workspaceScope: req.workspaceScope, path: req.path! });
    const key = `${req.workspaceScope}:${req.path}`;
    const outcome = table[key] ?? "NOT_FOUND";
    if (outcome === "ok") {
      return { ok: true, data: { content: "x", version: 1, mtimeMs: 1 } };
    }
    return { ok: false, error: { code: outcome, message: "miss" } };
  };
  return Object.assign(impl, { calls });
}

const SESSION_CTX = { projectId: "p1", sessionId: "s1" };
const PROJECT_CTX = { projectId: "p1" };

test("T-L6: chat 域（core session 域）命中 → preview/chat，且不再探 session 域", async () => {
  const vfsRead = makeVfsRead({ "chat:/续写/chapter.md": "ok" });
  const action = await resolveChatLinkAction(
    "%E7%BB%AD%E5%86%99/chapter.md",
    { sessionContext: SESSION_CTX, projectContext: PROJECT_CTX, vfsRead },
  );
  assert.deepEqual(action, {
    kind: "preview",
    workspaceScope: "chat",
    path: "/续写/chapter.md",
  });
  // 探测顺序断言：先 chat 域；命中即止
  assert.equal(vfsRead.calls.length, 1);
  assert.equal(vfsRead.calls[0]!.workspaceScope, "chat");
  // 请求形态双钉命名陷阱：chat 域带 projectId+sessionId（core session 域）
  assert.deepEqual(vfsRead.calls[0], {
    workspaceScope: "chat",
    path: "/续写/chapter.md",
  });
});

test("T-L6: chat 域未命中（NOT_FOUND）→ 继续探 session 域（core project 域）命中", async () => {
  const vfsRead = makeVfsRead({ "session:/notes/a.md": "ok" });
  const action = await resolveChatLinkAction("notes/a.md", {
    sessionContext: SESSION_CTX,
    projectContext: PROJECT_CTX,
    vfsRead,
  });
  assert.deepEqual(action, {
    kind: "preview",
    workspaceScope: "session",
    path: "/notes/a.md",
  });
  assert.equal(vfsRead.calls.length, 2);
  assert.equal(vfsRead.calls[0]!.workspaceScope, "chat");
  assert.equal(vfsRead.calls[1]!.workspaceScope, "session");
});

test("T-L6: IS_DIRECTORY（目录目标）等一切非 ok 按未命中 → 双未命中 none", async () => {
  const vfsRead = makeVfsRead({
    "chat:/notes": "IS_DIRECTORY",
    "session:/notes": "ok",
  });
  // /notes 是目录：chat 域返回 IS_DIRECTORY 必须按未命中，不得当文件打开
  const dirTarget = await resolveChatLinkAction("/notes", {
    sessionContext: SESSION_CTX,
    projectContext: PROJECT_CTX,
    vfsRead,
  });
  assert.deepEqual(dirTarget, {
    kind: "preview",
    workspaceScope: "session",
    path: "/notes",
  });
  const none = await resolveChatLinkAction("missing.md", {
    sessionContext: SESSION_CTX,
    projectContext: PROJECT_CTX,
    vfsRead,
  });
  assert.deepEqual(none, { kind: "none" });
});

test("T-L6: 会话上下文缺失跳过 chat 域，仅探 session 域", async () => {
  const vfsRead = makeVfsRead({ "session:/notes/a.md": "ok" });
  const action = await resolveChatLinkAction("notes/a.md", {
    sessionContext: null,
    projectContext: PROJECT_CTX,
    vfsRead,
  });
  assert.deepEqual(action, {
    kind: "preview",
    workspaceScope: "session",
    path: "/notes/a.md",
  });
  assert.equal(vfsRead.calls.length, 1);
  assert.equal(vfsRead.calls[0]!.workspaceScope, "session");
});

test("T-L6: http(s)/HTTP 大写 → external，不触发任何探测", async () => {
  const vfsRead = makeVfsRead({});
  for (const href of ["http://a.com/x", "https://a.com", "HTTP://A.com"]) {
    const action = await resolveChatLinkAction(href, {
      sessionContext: SESSION_CTX,
      projectContext: PROJECT_CTX,
      vfsRead,
    });
    assert.deepEqual(action, { kind: "external", url: href });
  }
  assert.equal(vfsRead.calls.length, 0);
});

test("T-L6: mailto / 非法序列 / 纯锚点 → none", async () => {
  const vfsRead = makeVfsRead({});
  for (const href of ["mailto:a@b.com", "%E4%ZZ", "#foo", ""]) {
    const action = await resolveChatLinkAction(href, {
      sessionContext: SESSION_CTX,
      projectContext: PROJECT_CTX,
      vfsRead,
    });
    assert.deepEqual(action, { kind: "none" });
  }
  assert.equal(vfsRead.calls.length, 0);
});

test("T-L6 源码契约: main.ts 挂 will-navigate + setWindowOpenHandler + openExternal", () => {
  const src = readSrc("src", "main", "main.ts");
  assert.ok(src.includes(`window.webContents.on("will-navigate"`));
  assert.ok(src.includes("event.preventDefault()"));
  assert.ok(src.includes("setWindowOpenHandler"));
  assert.ok(src.includes('{ action: "deny" }'));
  assert.ok(src.includes("shell.openExternal"));
});

test("T-L6 源码契约: MessageList 正文与流式尾巴均透传 onLinkClick；ConversationPanel/ShellNavProvider 接线", () => {
  const messageList = readSrc(
    "renderer",
    "features",
    "chat",
    "MessageList.tsx",
  );
  // 流式尾巴（chat-message--streaming 块内的 MermaidMarkdown）透传
  assert.ok(
    messageList.includes(
      `<MermaidMarkdown content={streamingText} onLinkClick={onLinkClick} />`,
    ),
  );
  // 正文消费点（MessageBody / CollapsibleMessageBody 两分支）透传
  assert.ok(
    messageList.includes(`<MermaidMarkdown content={text} onLinkClick={onLinkClick} />`),
  );
  const panel = readSrc(
    "renderer",
    "features",
    "chat",
    "ConversationPanel.tsx",
  );
  assert.ok(panel.includes("onLinkClick={openChatLink}"));
  const shell = readSrc("renderer", "providers", "ShellNavProvider.tsx");
  // 接线：探测经 ipcVfsRead、外跳消费现成 ipcAppOpenExternal、preview 复用 selectPreviewFile
  assert.ok(shell.includes("resolveChatLinkAction"));
  assert.ok(shell.includes("vfsRead: ipcVfsRead"));
  assert.ok(shell.includes("ipcAppOpenExternal(action.url)"));
  assert.ok(shell.includes('selectPreviewFile("session", action.path)'));
});
