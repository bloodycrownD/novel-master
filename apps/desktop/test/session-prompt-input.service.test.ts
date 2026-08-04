/**
 * T-CA5（desktop 侧）：预览口径 parity —— buildSessionPromptInput（预览路径）
 * 在 definition 带 customAttach 时，产出的 messages 里含 <extra-info> 块。
 *
 * 预览/真实两路最终都经 prepareUserMessagesForPrompt → wrapUserMessageForLlm，
 * 这里只断言预览路径的 extra-info 注入行为，避免 UI 预览与发给模型的提示词悄无声息走偏。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { buildDefaultAgentDefinitionPreservingName } from "@novel-master/core/config-forms/stored-config-validity";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import { buildSessionPromptInput } from "../src/main/services/session-prompt-input.service.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

/** 从消息 content（{ blocks: [...] }）里拼出纯文本，供断言关键字。 */
function bodyText(content: unknown): string {
  if (
    content == null ||
    typeof content !== "object" ||
    !Array.isArray((content as { blocks?: unknown }).blocks)
  ) {
    return "";
  }
  return (content as { blocks: unknown[] }).blocks
    .map((block) =>
      block != null &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text"
        ? String((block as { text?: unknown }).text ?? "")
        : "",
    )
    .join("\n");
}

describe("session-prompt-input.service (T-CA5 desktop)", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-session-prompt-"));

    const project = await handleProjectsCreate({ name: "extra-info-preview" });
    assert.equal(project.ok, true);
    if (!project.ok) return;
    projectId = project.data.id;

    // 注册空白 agent 并设为 workspace 当前，保证 session create 能复制到 agentId。
    const agent = await handleAgentRegistryCreateBlank();
    assert.equal(agent.ok, true);
    if (!agent.ok) return;
    const setAgent = await handleAgentSetCurrent({ agentId: agent.data.agentId });
    assert.equal(setAgent.ok, true);

    const session = await handleSessionsCreate({
      projectId,
      title: "extra-info-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) return;
    sessionId = session.data.id;

    const rt = await getDesktopRuntime();
    await rt.messages.append(sessionId, "user", textBlocks("你好，请记住附加信息"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("T-CA5: definition.prompts.customAttach 非空时预览路径 messages 含 <extra-info> 块", async () => {
    const rt = await getDesktopRuntime();
    const definition = buildDefaultAgentDefinitionPreservingName("extra-info-agent");
    // 与 domain prompts.customAttach 对齐；wrap 阶段在 </user-ops> 后注入 <extra-info>。
    definition.prompts = {
      ...definition.prompts,
      customAttach: "这是常驻附加信息：优先级最高",
    };

    const bundle = await buildSessionPromptInput(
      rt,
      { projectId, sessionId },
      definition,
    );

    const userBody = bundle.ctx.messages
      .filter((m) => m.role === "user")
      .map((m) => bodyText(m.content))
      .join("\n");

    assert.match(
      userBody,
      /<extra-info>/,
      "预览路径产出的 user 消息体应包含 <extra-info> 块",
    );
    assert.match(
      userBody,
      /这是常驻附加信息：优先级最高/,
      "customAttach 文本应原样出现在 extra-info 块内",
    );
  });
});
