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
import { PROMPT_FILE_SEEN_SHORT_TIP } from "../../src/domain/chat/logic/prompt-path-seen.js";
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

    // 外层无 <dir>；内层 basename+/ ASCII；├──/└──；dirs 先 files 后
    assert.equal(
      tree,
      [
        "notes/",
        "├── sub/",
        "└── a.md",
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
    assert.match(body, /<user-ops>/);
    assert.match(body, /<action name="userAttach">/);
    assert.match(body, /"kind": "dirTree"/);
    assert.match(body, /notes\//);
    assert.match(body, /├──/);
    assert.match(body, /└──/);
    assert.match(body, /a\.md/);
    assert.match(body, /sub\//);
    assert.ok(!body.includes("AAA"));
    assert.ok(!body.includes("b.md"));
    assert.ok(!body.includes("<dir "));
    assert.ok(!body.includes("<file"));
    assert.ok(!body.includes("<attach>"));
    assert.ok(!body.includes("<workplace>"));

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
    assert.match(body, /<user-ops>/);
    assert.match(body, /<action name="workplaceChange">/);
    assert.match(body, /<user-input>\n你好\n<\/user-input>/);
    assert.match(body, /workplace-body/);
    assert.ok(!body.includes("<workplace>"));
    assert.ok(!body.includes("<file "));
    assert.ok(!body.includes("createdAt="));
    assert.ok(!body.includes("mtime"));
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

  it("T-SR6 / T-PD6: Agent prepare 与 RealPrompt 同源（assemble→prepare(S0)）用户段 wrap 一致", async () => {
    // Desktop/Mobile buildSessionPromptInput = assemble → prepare(S0) → buildPromptLlmInputFromLayout；
    // Agent runner 每 step 同样 assemble → prepare(S0)。此处钉用户段 wrap 文本一致。
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
      seenPaths: [] as string[],
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
      workplaceDisplay: "",
      messages: realPromptPrepared,
    });
    const realPromptUser = input.messages.find((m) => m.id === stored.id);
    assert.ok(realPromptUser, "layout 须含原 user 消息");
    const realPromptUserWrap = messageBodyText(realPromptUser);

    // 同 path：attach 优先，workplace 不进；二者同源；单一 <user-ops>
    assert.match(agentUserWrap, /<user-ops>/);
    assert.match(agentUserWrap, /<action name="userAttach">/);
    assert.match(agentUserWrap, /<action name="write">/);
    assert.match(agentUserWrap, /<user-input>\n继续\n<\/user-input>/);
    assert.equal(
      agentUserWrap.includes("<workplace>"),
      false,
      "同 path 时 workplace 应被 attach 抢先 seen 后省略",
    );
    assert.equal(agentUserWrap.includes("<attach>"), false);
    // T-PR1：action 顺序 attach → workplace → user_ops（本例无 workplace 内容）
    const attachIdx = agentUserWrap.indexOf('name="userAttach"');
    const writeIdx = agentUserWrap.indexOf('name="write"');
    assert.ok(attachIdx >= 0 && writeIdx > attachIdx);
    assert.equal(
      realPromptUserWrap,
      agentUserWrap,
      "RealPrompt 用户段 wrap 须与 Agent prepare 一致",
    );
  });
});

describe("prepareUserMessagesForPrompt path degrade (T-PD*)", () => {
  it("T-PD1 / T-PR2: 可见消息首次文件 attach → userAttach JSON 行号正文，无 <file>/mtime", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/a.md", "FULL-BODY-A");
    const sk = createSessionKkvService(ctx.conn);

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("first", {
          sessionId: session.id,
          attachments: [
            {
              name: "/a.md",
              source: "attach",
              type: "text",
              content: null,
              path: "/a.md",
            },
          ],
        }),
      ],
      { sessionId: session.id, sessionKkv: sk, vfs },
    );
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<action name="userAttach">/);
    assert.match(body, /"display": "full"/);
    assert.match(body, /1\|FULL-BODY-A/);
    assert.equal(body.includes("<file "), false);
    assert.equal(body.includes("createdAt="), false);
    assert.equal(body.includes("mtime"), false);
    assert.equal(body.includes(PROMPT_FILE_SEEN_SHORT_TIP), false);
  });

  it("T-PD2 / T-PR2: 第二条可见消息同 path 文本 attach → alreadyReferenced，无 content", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/a.md", "FULL-BODY-A");
    const sk = createSessionKkvService(ctx.conn);

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("m1", {
          id: "u1",
          sessionId: session.id,
          attachments: [
            {
              name: "/a.md",
              source: "attach",
              type: "text",
              content: null,
              path: "/a.md",
            },
          ],
        }),
        userMsg("m2", {
          id: "u2",
          sessionId: session.id,
          attachments: [
            {
              name: "/a.md",
              source: "attach",
              type: "text",
              content: null,
              path: "/a.md",
            },
          ],
        }),
      ],
      { sessionId: session.id, sessionKkv: sk, vfs },
    );
    const body2 = messageBodyText(prepared[1]!);
    assert.match(body2, /<action name="userAttach">/);
    assert.match(body2, /"alreadyReferenced": true/);
    assert.equal(body2.includes("FULL-BODY-A"), false);
    assert.equal(body2.includes("createdAt="), false);
    assert.equal(body2.includes("1|"), false);
    assert.equal(body2.includes('"content"'), false);
  });

  it("T-PD3: 常驻前缀已含 path A 时再 @A（缺前导 /）→ alreadyReferenced；落库 path 带 /", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/pref.md", "PREFIX-BODY");
    const sk = createSessionKkvService(ctx.conn);

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("again", {
          sessionId: session.id,
          attachments: [
            {
              name: "pref.md",
              source: "attach",
              type: "text",
              content: null,
              // 故意缺前导 /：规范化后与 S0 同 key
              path: "pref.md",
            },
          ],
        }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs,
        seenPaths: ["/pref.md"],
      },
    );
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<action name="userAttach">/);
    assert.match(body, /"path": "\/pref\.md"/);
    assert.match(body, /"alreadyReferenced": true/);
    assert.equal(body.includes("PREFIX-BODY"), false);
    assert.equal(prepared[0]!.attachments?.[0]?.path, "/pref.md");
  });

  it("T-PD4 / T-PR1: 同条 workplace+attach 同 path → 仅 userAttach 有内容；顺序 attach 先", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/same.md", "SAME-BODY");
    const sk = createSessionKkvService(ctx.conn);

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("conflict", {
          sessionId: session.id,
          attachments: [
            {
              name: "/same.md",
              source: "workplace",
              type: "text",
              content: null,
              path: "/same.md",
            },
            {
              name: "/same.md",
              source: "attach",
              type: "text",
              content: null,
              path: "/same.md",
            },
          ],
        }),
      ],
      { sessionId: session.id, sessionKkv: sk, vfs },
    );
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<user-ops>/);
    assert.match(body, /<action name="userAttach">/);
    assert.match(body, /SAME-BODY/);
    assert.equal(body.includes("<workplace>"), false);
    assert.equal(body.includes("<attach>"), false);
    assert.equal(body.includes('name="workplaceChange"'), false);
    const wp = prepared[0]!.attachments?.find((a) => a.source === "workplace");
    assert.equal(wp?.content, "");
  });

  it("T-PD5: 目录 attach 两次均含 dirTree；目录计 seen 后同 path 文件为非首次", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.mkdir("/notes");
    await vfs.write("/notes/a.md", "note-a");
    // 同 seen key：目录 /notes 与文件 /notes 冲突场景用独立文件 path
    await vfs.write("/notes.md", "FILE-AT-NOTES");
    const sk = createSessionKkvService(ctx.conn);

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("d1", {
          id: "d1",
          sessionId: session.id,
          attachments: [
            {
              name: "/notes",
              source: "attach",
              type: "dir",
              content: null,
              path: "/notes/",
            },
          ],
        }),
        userMsg("d2", {
          id: "d2",
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
        }),
        userMsg("file-after-dir", {
          id: "f1",
          sessionId: session.id,
          attachments: [
            {
              name: "/notes",
              source: "attach",
              type: "text",
              content: null,
              // 与目录 seen key 相同（去尾 /）→ 短提示；此处用 /notes 作为「伪文件」
              // 实际 VFS 上 /notes 是目录，hydrate 会 missing；我们测 seen 降级即可
              path: "/notes",
            },
          ],
        }),
      ],
      { sessionId: session.id, sessionKkv: sk, vfs },
    );
    const b1 = messageBodyText(prepared[0]!);
    const b2 = messageBodyText(prepared[1]!);
    const b3 = messageBodyText(prepared[2]!);
    assert.match(b1, /"kind": "dirTree"/);
    assert.match(b2, /"kind": "dirTree"/);
    assert.equal(b1.includes(PROMPT_FILE_SEEN_SHORT_TIP), false);
    assert.equal(b2.includes(PROMPT_FILE_SEEN_SHORT_TIP), false);
    assert.match(b3, /"alreadyReferenced": true/);
    assert.match(b3, /"path": "\/notes"/);
  });

  it("T-PD7: image/binary attach 非首次 → 仍 filename 档，无 alreadyReferenced", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    await vfs.write("/pic.png", "bin");
    const sk = createSessionKkvService(ctx.conn);

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("i1", {
          id: "i1",
          sessionId: session.id,
          attachments: [
            {
              name: "/pic.png",
              source: "attach",
              type: "image",
              content: null,
              path: "/pic.png",
            },
          ],
        }),
        userMsg("i2", {
          id: "i2",
          sessionId: session.id,
          attachments: [
            {
              name: "/pic.png",
              source: "attach",
              type: "image",
              content: null,
              path: "/pic.png",
            },
          ],
        }),
      ],
      { sessionId: session.id, sessionKkv: sk, vfs },
    );
    const body2 = messageBodyText(prepared[1]!);
    assert.match(body2, /<action name="userAttach">/);
    assert.match(body2, /"display": "filename"/);
    assert.match(body2, /1\|pic\.png/);
    assert.equal(body2.includes("alreadyReferenced"), false);
    assert.equal(body2.includes("<file "), false);
    assert.equal(body2.includes("createdAt="), false);
  });

  it("旧 <file> 落库内容 hydrate → 剥壳转 action JSON，不原样进 <user-ops>", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const sk = createSessionKkvService(ctx.conn);
    const legacyFile = `<file path="/legacy.md" createdAt="x" updatedAt="x" updatedBy="user">
1|hello
2|world
</file>`;
    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("看旧附件", {
          sessionId: session.id,
          attachments: [
            {
              name: "/legacy.md",
              source: "attach",
              type: "text",
              content: legacyFile,
              path: "/legacy.md",
            },
          ],
        }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs,
      },
    );
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<user-ops>/);
    assert.match(body, /<action name="userAttach">/);
    assert.match(body, /"path": "\/legacy\.md"/);
    assert.match(body, /1\|hello/);
    assert.match(body, /2\|world/);
    assert.equal(body.includes("<file "), false);
    assert.equal(body.includes("createdAt="), false);
    const att = prepared[0]!.attachments?.[0];
    assert.equal(att?.action, "userAttach");
    assert.equal(att?.content?.includes("<file "), false);
  });

  it("T-PD8: 仅 workplace/attach 但 hydrate 后全部 body 空 → wrap 等于 plainText", async () => {
    const plain = "只有原文";
    const wrapped = wrapUserMessageForLlm(plain, [
      {
        name: "/gone.md",
        source: "workplace",
        type: "text",
        content: "",
        path: "/gone.md",
      },
      {
        name: "/gone.md",
        source: "attach",
        type: "text",
        content: "   ",
        path: "/gone.md",
      },
    ]);
    assert.equal(wrapped, plain);
    assert.equal(wrapped.includes("<attachment>"), false);

    // prepare：S0 已含 path → workplace 空；无其它非空 section
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const vfs = ctx.sessionVfs(project.id, session.id);
    const sk = createSessionKkvService(ctx.conn);
    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg(plain, {
          sessionId: session.id,
          attachments: [
            {
              name: "/gone.md",
              source: "workplace",
              type: "text",
              content: null,
              path: "/gone.md",
            },
          ],
        }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs,
        seenPaths: ["/gone.md"],
      },
    );
    assert.equal(messageBodyText(prepared[0]!), plain);
  });
});
