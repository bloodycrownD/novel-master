/**
 * T-SK12（hydrate 侧）：skillAttach 附件 hydrate 与 seen 去重（镜像 T-PD2/T-PD3 写法）。
 * 首次全文 / alreadyReferenced 短标记 / skill: 命名空间与路径 seen 隔离 /
 * 不存在技能名提示行且不写 seen（自愈）/ 无效与禁用技能仍附原文 /
 * 置位压缩重置随可见窗口继承 / skills 未接线原样带过 /
 * seen 共享方向 B：assistant 已 load 过的技能，后续 $ 引用走短标记。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { messageBodyText } from "../../src/domain/chat/content/message-body-text.js";
import { prepareUserMessagesForPrompt } from "../../src/domain/chat/logic/prepare-user-messages-for-prompt.js";
import type { ChatMessage } from "../../src/domain/chat/model/message.js";
import type { MessageAttachment } from "../../src/domain/chat/model/message-attachment.schema.js";
import type {
  EffectiveSkill,
} from "../../src/domain/skills/logic/effective-skills.js";
import type {
  SkillFileContent,
  SkillService,
} from "../../src/service/skills/skills.port.js";
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
    hidden: false,
    ...(options?.attachments != null
      ? { attachments: options.attachments }
      : {}),
  };
}

function skillAttach(name: string): MessageAttachment {
  return {
    name,
    source: "attach",
    type: "text",
    content: null,
    skillName: name,
    action: "skillAttach",
  };
}

/** 可见历史里的 assistant 消息（带 skill 工具 tool_use 块，方向 B 扫描用）。 */
function assistantSkillLoadMsg(
  action: string,
  skillName: string,
  id = "a1",
): ChatMessage {
  return {
    id,
    sessionId: "s1",
    seq: 2,
    role: "assistant",
    content: {
      blocks: [
        {
          type: "tool_use",
          id: "tu1",
          name: "skill",
          input: { action, name: skillName },
        },
      ],
    },
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

const SKILL_MD = "---\nname: demo\ndescription: 演示\n---\n# 演示技能\n正文内容";

/** fake SkillService：只实现 skillAttach hydrate 用到的两个方法，状态可变供自愈用例。 */
function fakeSkillService(state: {
  names: string[];
  content?: string;
  readError?: boolean;
}): SkillService & { readonly state: typeof state } {
  const service = {
    effectiveSkills: async (): Promise<EffectiveSkill[]> =>
      state.names.map((name) => ({
        name,
        description: null,
        domain: "project",
        overridden: false,
        disabled: false,
        valid: true,
        effective: true,
      })),
    readSkillFile: async (): Promise<SkillFileContent> => {
      if (state.readError) {
        throw new Error("skill file gone");
      }
      return {
        domain: "project",
        name: "demo",
        path: "SKILL.md",
        content: state.content ?? SKILL_MD,
        version: 1,
      };
    },
  } as unknown as SkillService;
  return Object.assign(service, { state });
}

describe("prepareUserMessagesForPrompt skillAttach (T-SK12)", () => {
  it("首次出现：读生效副本 SKILL.md 全文附 skillAttach；正文 token 原样保留", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: ["demo"] });

    const prepared = await prepareUserMessagesForPrompt(
      [userMsg("用 $demo 改一下", { sessionId: session.id, attachments: [skillAttach("demo")] })],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
        skills,
        projectId: project.id,
      },
    );
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /<action name="skillAttach">/);
    assert.match(body, /"name": "demo"/);
    // SKILL.md 全文（含 front matter 原样）
    assert.match(body, /---\\nname: demo/);
    assert.match(body, /# 演示技能/);
    // 正文 token 不剥离
    assert.match(body, /<user-input>\n用 \$demo 改一下\n<\/user-input>/);
  });

  it("第二条可见消息同技能 → alreadyReferenced 短标记，无全文（镜像 T-PD2）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: ["demo"] });

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("m1", { id: "u1", sessionId: session.id, attachments: [skillAttach("demo")] }),
        userMsg("m2", { id: "u2", sessionId: session.id, attachments: [skillAttach("demo")] }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
        skills,
        projectId: project.id,
      },
    );
    const body2 = messageBodyText(prepared[1]!);
    assert.match(body2, /<action name="skillAttach">/);
    assert.match(body2, /"alreadyReferenced": true/);
    assert.equal(body2.includes("# 演示技能"), false);
    assert.equal(body2.includes('"content"'), false);
  });

  it("不存在技能名：一行提示而非全文，且不写 seen（同轮再引仍是提示行，非 alreadyReferenced）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: ["other"] });

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("m1", { id: "u1", sessionId: session.id, attachments: [skillAttach("ghost")] }),
        userMsg("m2", { id: "u2", sessionId: session.id, attachments: [skillAttach("ghost")] }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
        skills,
        projectId: project.id,
      },
    );
    for (const m of prepared) {
      const body = messageBodyText(m!);
      assert.match(body, /<action name="skillAttach">/);
      assert.match(body, /"missing": true/);
      assert.match(body, /技能不存在或已删除/);
      assert.equal(body.includes('"alreadyReferenced"'), false);
    }
  });

  it("自愈：上轮不存在（不写 seen），技能创建后再次引用重新附全文", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: [] });

    const runtimeBase = {
      sessionId: session.id,
      sessionKkv: sk,
      vfs: ctx.sessionVfs(project.id, session.id),
      skills,
      projectId: project.id,
    };
    const before = await prepareUserMessagesForPrompt(
      [userMsg("m1", { sessionId: session.id, attachments: [skillAttach("demo")] })],
      runtimeBase,
    );
    assert.match(messageBodyText(before[0]!), /技能不存在或已删除/);

    // 技能被创建：同一条消息再次 prepare → 重新附全文（seen 不残留）
    skills.state.names.push("demo");
    const after = await prepareUserMessagesForPrompt(
      [userMsg("m1", { sessionId: session.id, attachments: [skillAttach("demo")] })],
      runtimeBase,
    );
    const body = messageBodyText(after[0]!);
    assert.match(body, /# 演示技能/);
    assert.equal(body.includes("技能不存在或已删除"), false);
  });

  it("存在但无效（front matter 缺失）与禁用技能：仍附 SKILL.md 原文，不视为不存在", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const entries: EffectiveSkill[] = [
      {
        name: "broken",
        description: null,
        domain: "project",
        overridden: false,
        disabled: false,
        valid: false,
        invalidReason: "front matter 不可解析",
        effective: false,
      },
      {
        name: "off",
        description: null,
        domain: "global",
        overridden: false,
        disabled: true,
        valid: true,
        effective: false,
      },
    ];
    const service = {
      effectiveSkills: async () => entries,
      readSkillFile: async (): Promise<SkillFileContent> => ({
        domain: "project",
        name: "x",
        path: "SKILL.md",
        content: SKILL_MD,
        version: 1,
      }),
    } as unknown as SkillService;

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("m1", {
          sessionId: session.id,
          attachments: [skillAttach("broken"), skillAttach("off")],
        }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
        skills: service,
        projectId: project.id,
      },
    );
    const body = messageBodyText(prepared[0]!);
    assert.equal((body.match(/# 演示技能/g) ?? []).length, 2);
    assert.equal(body.includes("技能不存在或已删除"), false);
  });

  it("读盘竞态失败（判定存在但读取抛错）→ 按不存在提示，不写 seen", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: ["demo"], readError: true });

    const prepared = await prepareUserMessagesForPrompt(
      [
        userMsg("m1", { sessionId: session.id, attachments: [skillAttach("demo")] }),
        userMsg("m2", { id: "u2", sessionId: session.id, attachments: [skillAttach("demo")] }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
        skills,
        projectId: project.id,
      },
    );
    for (const m of prepared) {
      assert.match(messageBodyText(m!), /技能不存在或已删除/);
      assert.equal(messageBodyText(m!).includes('"alreadyReferenced"'), false);
    }
  });

  it("置位/压缩重置：可见窗口只剩后一条消息时 seen 重新开始 → 再次全文（镜像 T-PD3 可见窗口语义）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: ["demo"] });
    const runtimeBase = {
      sessionId: session.id,
      sessionKkv: sk,
      vfs: ctx.sessionVfs(project.id, session.id),
      skills,
      projectId: project.id,
    };

    // 全窗口：m1 全文、m2 短标记
    const full = await prepareUserMessagesForPrompt(
      [
        userMsg("m1", { id: "u1", sessionId: session.id, attachments: [skillAttach("demo")] }),
        userMsg("m2", { id: "u2", sessionId: session.id, attachments: [skillAttach("demo")] }),
      ],
      runtimeBase,
    );
    assert.match(messageBodyText(full[0]!), /# 演示技能/);
    assert.match(messageBodyText(full[1]!), /"alreadyReferenced": true/);

    // 压缩/置位后可见窗口只剩 m2：skill seen 随窗口重置 → 再次全文
    const compacted = await prepareUserMessagesForPrompt(
      [userMsg("m2", { id: "u2", sessionId: session.id, attachments: [skillAttach("demo")] })],
      runtimeBase,
    );
    assert.match(messageBodyText(compacted[0]!), /# 演示技能/);
  });

  it("S0 前缀集不预填技能 key：常驻路径 seen 与 skill: 命名空间隔离", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: ["demo"] });

    const prepared = await prepareUserMessagesForPrompt(
      [userMsg("m1", { sessionId: session.id, attachments: [skillAttach("demo")] })],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
        skills,
        projectId: project.id,
        // 同名路径进 S0 不影响技能首次全文（skill:demo ≠ /demo）
        seenPaths: ["/demo"],
      },
    );
    const body = messageBodyText(prepared[0]!);
    assert.match(body, /# 演示技能/);
    assert.equal(body.includes('"alreadyReferenced"'), false);
  });

  it("方向 B：可见历史 assistant 已 load 过的技能 → 后续 $ 引用 alreadyReferenced，不重复附全文", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: ["demo"] });

    const prepared = await prepareUserMessagesForPrompt(
      [
        // load 的全文以 tool_result 形式留在可见历史，无需再附
        assistantSkillLoadMsg("load", "demo"),
        userMsg("再用 $demo 检查", {
          id: "u1",
          sessionId: session.id,
          attachments: [skillAttach("demo")],
        }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
        skills,
        projectId: project.id,
      },
    );
    const body = messageBodyText(prepared.at(-1)!);
    assert.match(body, /"alreadyReferenced": true/);
    assert.equal(body.includes("# 演示技能"), false);
  });

  it("方向 B 边界：assistant 的 read tool_use 不预填 seen（read 可能截断，与 load 不同语义）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);
    const skills = fakeSkillService({ names: ["demo"] });

    const prepared = await prepareUserMessagesForPrompt(
      [
        assistantSkillLoadMsg("read", "demo"),
        userMsg("用 $demo", {
          id: "u1",
          sessionId: session.id,
          attachments: [skillAttach("demo")],
        }),
      ],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
        skills,
        projectId: project.id,
      },
    );
    const body = messageBodyText(prepared.at(-1)!);
    assert.match(body, /# 演示技能/);
    assert.equal(body.includes('"alreadyReferenced"'), false);
  });

  it("skills 未接线：skillAttach 附件原样带过（不读盘、不写 seen、不炸）", async () => {
    const ctx = getNovelMasterTestContext();
    const project = await ctx.projects.create(`P-${testIsolationSuffix()}`);
    const session = await ctx.sessions.create(project.id);
    const sk = createSessionKkvService(ctx.conn);

    const att = skillAttach("demo");
    const prepared = await prepareUserMessagesForPrompt(
      [userMsg("m1", { sessionId: session.id, attachments: [att] })],
      {
        sessionId: session.id,
        sessionKkv: sk,
        vfs: ctx.sessionVfs(project.id, session.id),
      },
    );
    assert.deepEqual(prepared[0]!.attachments, [att]);
    // 无可拼 body → wrap 恒等原文
    assert.equal(messageBodyText(prepared[0]!), "m1");
  });
});
