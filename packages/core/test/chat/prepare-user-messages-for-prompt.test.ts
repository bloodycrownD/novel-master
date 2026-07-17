/**
 * Step 6：prepare / wrap / dir tree / file_cache / transcript 原文（T-AT* T-TX*）。
 * T-SR6：Agent prepare 与 RealPrompt `buildSessionPromptInput` 同源路径用户段 wrap 一致。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { buildPromptLlmInputFromLayout } from "@novel-master/core/prompt";
import { messageBodyText } from "../../src/domain/chat/content/message-body-text.js";
import { extractEditableTextFromMessage } from "../../src/domain/chat/logic/editable-text-from-message.js";
import { prepareUserMessagesForPrompt } from "../../src/domain/chat/logic/prepare-user-messages-for-prompt.js";
import { wrapUserMessageForLlm } from "../../src/domain/chat/logic/wrap-user-message-for-llm.js";
import {
  renderDirAttachTree,
} from "../../src/domain/chat/logic/render-dir-attach-tree.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";
import {
  fileCacheKey,
  SESSION_KKV_DOMAIN_FILE_CACHE,
} from "../../src/domain/session-kkv/model/session-kkv-domains.js";
import { createSessionKkvService } from "../../src/service/session-kkv/create-session-kkv-service.js";
import {
  getNovelMasterTestContext,
  novelMasterTestFixture,
  testIsolationSuffix,
} from "../helpers/novel-master-fixture.js";

novelMasterTestFixture();

function userMsg(
  text: string,
  options?: {
    readonly attachments?: readonly MessageAttachment[];
    readonly hidden?: boolean;
    readonly id?: string;
    readonly sessionId?: string;
  },
): ChatMessage {
  return {
    id: options?.id ?? "u1",
    sessionId: options?.sessionId ?? "s1",
    seq: 1,
    role: "user",
    content: textBlocks(text),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: options?.hidden ?? false,
    ...(options?.attachments != null
      ? { attachments: options.attachments }
      : {}),
  };
}

describe("wrapUserMessageForLlm / prepareUserMessagesForPrompt (Step 6)", () => {
  it("T-AT1: 仅 text 无附件 → wrap 恒等", () => {
    assert.equal(wrapUserMessageForLlm("你好", undefined), "你好");
    assert.equal(wrapUserMessageForLlm("你好", []), "你好");
  });

  it("T-AT2: user_ops + text → wrap 含 user-ops 与 user-input；库内仍为原文", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const actionXml = `<action name="write">\n{"path":"/x.md","content":""}\n</action>`;
    const attachments: MessageAttachment[] = [
      {
        name: "ops",
        source: "user_ops",
        type: "text",
        content: actionXml,
      },
    ];
    const stored = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("继续"),
      { attachments },
    );
    assert.equal(messageBodyText(stored), "继续");
    assert.equal(messageBodyText(stored).includes("<attachment>"), false);

    const sk = createSessionKkvService(ctx.conn);
    const prepared = await prepareUserMessagesForPrompt([stored], {
      sessionId: session.id,
      sessionKkv: sk,
      vfs: ctx.sessionVfs(project.id, session.id),
    });
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<user-ops>/);
    assert.match(body, /<action name="write">/);
    assert.match(body, /<user-input>\n继续\n<\/user-input>/);
    assert.ok((prepared[0]!.attachments?.length ?? 0) > 0);

    const reloaded = await ctx.messages.get(stored.id);
    assert.equal(messageBodyText(reloaded), "继续");
  });

  it("T-AT3: dir attach → <dir path>+$filetree ASCII depth=1，无深层/正文/file_cache", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/notes");
    await vfs.mkdir("/notes/sub");
    await vfs.write("/notes/a.md", "AAA");
    await vfs.write("/notes/sub/b.md", "BBB");

    const sk = createSessionKkvService(ctx.conn);
    const tree = await renderDirAttachTree("/notes", {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
    });

    // 外层 <dir path> + 内层 basename+/ ASCII；├──/└──；dirs 先 files 后
    assert.equal(
      tree,
      [
        `<dir path="/notes">`,
        "notes/",
        "├── sub/",
        "└── a.md",
        `</dir>`,
      ].join("\n"),
    );
    assert.ok(tree.includes("├──"));
    assert.ok(tree.includes("└──"));
    // 禁止嵌套展开、文件正文、内嵌 <file>、宏加载后缀
    assert.ok(!tree.includes("b.md"));
    assert.ok(!tree.includes("/notes/sub"));
    assert.ok(!tree.includes("AAA"));
    assert.ok(!tree.includes("BBB"));
    assert.ok(!tree.includes("<file"));
    assert.ok(!tree.includes("全部加载"));

    const cacheKeysBefore = await sk.listKeys(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
    );

    const msg = userMsg("看目录", {
      sessionId: session.id,
      attachments: [
        {
          name: "/notes",
          source: "attach",
          type: "dir",
          content: null,
          path: "/notes",
        },
      ],
    });
    const prepared = await prepareUserMessagesForPrompt([msg], {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
    });
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<attach>/);
    assert.match(body, /<dir path="\/notes">/);
    assert.match(body, /<\/dir>/);
    assert.match(body, /notes\//);
    assert.match(body, /├──/);
    assert.match(body, /└──/);
    assert.match(body, /a\.md/);
    assert.match(body, /sub\//);
    assert.ok(!body.includes("AAA"));
    assert.ok(!body.includes("b.md"));
    assert.ok(!body.includes("<file"));

    const cacheKeysAfter = await sk.listKeys(
      session.id,
      SESSION_KKV_DOMAIN_FILE_CACHE,
    );
    assert.deepEqual(cacheKeysAfter, cacheKeysBefore);
  });

  it("T-AT4: @ 文本写 full；@ 二进制写 filename", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/doc.md", "hello-doc");
    await vfs.write("/pic.png", "fake-binary");

    const sk = createSessionKkvService(ctx.conn);
    const msg = userMsg("refs", {
      sessionId: session.id,
      attachments: [
        {
          name: "/doc.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/doc.md",
        },
        {
          name: "/pic.png",
          source: "attach",
          type: "image",
          content: null,
          path: "/pic.png",
        },
      ],
    });
    await prepareUserMessagesForPrompt([msg], {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
    });

    assert.ok(
      (await sk.get(
        session.id,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        fileCacheKey("full", "/doc.md"),
      )) != null,
    );
    assert.ok(
      (await sk.get(
        session.id,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        fileCacheKey("filename", "/pic.png"),
      )) != null,
    );
  });

  it("T-TX1/T-TX2: 落库气泡/可编辑原文无 wrap；attachments 可恢复", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/w.md", "workplace-body");

    const attachments: MessageAttachment[] = [
      {
        name: "/w.md",
        source: "workplace",
        type: "text",
        content: null,
        path: "/w.md",
      },
    ];
    const stored = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("你好"),
      { attachments },
    );
    assert.equal(messageBodyText(stored), "你好");
    assert.equal(extractEditableTextFromMessage(stored), "你好");
    assert.deepEqual(stored.attachments, attachments);
    assert.equal(messageBodyText(stored).includes("<user-input>"), false);
  });

  it("T-TX3: prepare 后提示词段含 attachment wrap 与原文", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/w.md", "workplace-body");
    const sk = createSessionKkvService(ctx.conn);

    const stored = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("你好"),
      {
        attachments: [
          {
            name: "/w.md",
            source: "workplace",
            type: "text",
            content: null,
            path: "/w.md",
          },
        ],
      },
    );
    const prepared = await prepareUserMessagesForPrompt([stored], {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
    });
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<attachment>/);
    assert.match(body, /<workplace>/);
    assert.match(body, /<user-input>\n你好\n<\/user-input>/);
    assert.match(body, /workplace-body/);
  });

  it("hidden user 不 hydrate/wrap（T-HD1；agent-runner / session-prompt-input 已接线 prepare）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/h.md", "secret");
    const sk = createSessionKkvService(ctx.conn);

    const hidden = userMsg("隐藏", {
      sessionId: session.id,
      hidden: true,
      attachments: [
        {
          name: "/h.md",
          source: "attach",
          type: "text",
          content: null,
          path: "/h.md",
        },
      ],
    });
    const prepared = await prepareUserMessagesForPrompt([hidden], {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
    });
    assert.equal(messageBodyText(prepared[0]!), "隐藏");
    assert.equal(messageBodyText(prepared[0]!).includes("<attachment>"), false);
    assert.equal(
      await sk.get(
        session.id,
        SESSION_KKV_DOMAIN_FILE_CACHE,
        fileCacheKey("full", "/h.md"),
      ),
      null,
    );
  });

  it("T-SR6: Agent prepare 与 RealPrompt buildSessionPromptInput 同源路径用户段 wrap 一致", async () => {
    // Desktop/Mobile buildSessionPromptInput = prepare → assemble → buildPromptLlmInputFromLayout；
    // Agent runner 每 step 同样先 prepare 再 layout。此处钉用户段 wrap 文本一致。
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/wp.md", "workplace-body");
    const sk = createSessionKkvService(ctx.conn);

    const actionXml =
      '<action name="write">\n{"path":"/ops.md","content":""}\n</action>';
    const stored = await ctx.messages.append(
      session.id,
      "user",
      textBlocks("继续"),
      {
        attachments: [
          {
            name: "/wp.md",
            source: "workplace",
            type: "text",
            content: null,
            path: "/wp.md",
          },
          {
            name: "write",
            source: "user_ops",
            type: "text",
            content: actionXml,
          },
          {
            name: "/wp.md",
            source: "attach",
            type: "text",
            content: null,
            path: "/wp.md",
          },
        ],
      },
    );

    const prepareRuntime = {
      sessionId: session.id,
      sessionKkv: sk,
      vfs,
    };
    // Agent 路径：对 DB 原文 prepare
    const agentPrepared = await prepareUserMessagesForPrompt(
      [stored],
      prepareRuntime,
    );
    const agentUserWrap = messageBodyText(agentPrepared[0]!);

    // RealPrompt / buildSessionPromptInput 同源：重新 list → prepare → layout
    const listed = (await ctx.messages.listBySession(session.id)).filter(
      (m) => !m.hidden,
    );
    const realPromptPrepared = await prepareUserMessagesForPrompt(
      listed,
      prepareRuntime,
    );
    const layout = {
      persistEnabled: false as const,
      persist: [] as const,
      dynamic: [] as const,
    };
    const input = await buildPromptLlmInputFromLayout(layout, {
      worktreeDisplay: "",
      messages: realPromptPrepared,
    });
    const realPromptUser = input.messages.find((m) => m.id === stored.id);
    assert.ok(realPromptUser, "layout 须含原 user 消息");
    const realPromptUserWrap = messageBodyText(realPromptUser);

    assert.match(agentUserWrap, /<workplace>/);
    assert.match(agentUserWrap, /<user-ops>/);
    assert.match(agentUserWrap, /<attach>/);
    assert.match(agentUserWrap, /<user-input>\n继续\n<\/user-input>/);
    assert.equal(
      realPromptUserWrap,
      agentUserWrap,
      "RealPrompt 用户段 wrap 须与 Agent prepare 一致",
    );
  });
});
