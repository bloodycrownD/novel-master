/**
 * T-CA5（desktop 侧）：预览口径 parity —— buildSessionPromptInput（预览路径）
 * 在 definition 带 customAttach 时，产出的 messages 里含 <extra-info> 块。
 *
 * 预览/真实两路最终都经 prepareUserMessagesForPrompt → wrapUserMessageForLlm，
 * 这里只断言预览路径的 extra-info 注入行为，避免 UI 预览与发给模型的提示词悄无声息走偏。
 *
 * r3-dt-align 第 3 层：build 的分段弃权（shouldBail）。真实 build 有五段（解析
 * agent / 取可见消息 / assemble 工作区 / prepare 消息 / 拼 layout），这里逐段把
 * 判据翻真，钉住「抛 ChatPromptBuildBailedError 且**后续段一次都不执行**」——
 * 只断言「抛错」是不够的：把 bail 挪到最后一段同样会抛错，却把整趟重活跑完了。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { textBlocks } from "@novel-master/core/chat";
import { buildDefaultAgentDefinitionPreservingName } from "@novel-master/core/config-forms/stored-config-validity";
import { serializeRuleSnapshot } from "@novel-master/core/workplace";
import { handleProjectsCreate } from "../src/main/ipc/handlers/projects.js";
import { handleAgentRegistryCreateBlank } from "../src/main/ipc/handlers/agent-registry.js";
import { handleAgentSetCurrent } from "../src/main/ipc/handlers/agent.js";
import { handleSessionsCreate } from "../src/main/ipc/handlers/sessions.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import type { DesktopNovelMasterRuntime } from "../src/main/runtime/types.js";
import {
  buildSessionPromptInput,
  ChatPromptBuildBailedError,
} from "../src/main/services/session-prompt-input.service.js";
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

/**
 * r3-dt-align 第 3 层：build 分段弃权。
 *
 * 探针口径：`buildSessionPromptInput` 的五段各自在 runtime 上留下可数的足迹——
 * ① 解析 agent（无 runtime 足迹）② `messages.listBySession` ③ `workplace()` /
 * `sessionVfs()` + assemble ④ `skills()`（prepare 的参数）⑤ 拼 layout。
 * 于是「第 N 个检查点翻真 ⇒ 第 N+1 段没跑」是可以真断言的，而不是靠时序赌。
 */
describe("session-prompt-input.service：build 分段弃权（r3-dt-align）", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-build-bail-"));
    const project = await handleProjectsCreate({ name: "build-bail" });
    assert.equal(project.ok, true);
    if (!project.ok) return;
    projectId = project.data.id;
    const agent = await handleAgentRegistryCreateBlank();
    assert.equal(agent.ok, true);
    if (!agent.ok) return;
    const setAgent = await handleAgentSetCurrent({ agentId: agent.data.agentId });
    assert.equal(setAgent.ok, true);
    const session = await handleSessionsCreate({ projectId, title: "build-bail" });
    assert.equal(session.ok, true);
    if (!session.ok) return;
    sessionId = session.data.id;
    const rt = await getDesktopRuntime();
    await rt.messages.append(sessionId, "user", textBlocks("他把伞收了"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  /** 数各段的调用足迹。 */
  function probeRuntime(rt: DesktopNovelMasterRuntime): {
    runtime: DesktopNovelMasterRuntime;
    counts: { list: number; workplace: number; skills: number };
  } {
    const counts = { list: 0, workplace: 0, skills: 0 };
    const messages = new Proxy(rt.messages, {
      get(target, prop, receiver) {
        if (prop === "listBySession") {
          return async (...args: unknown[]) => {
            counts.list += 1;
            return (
              target.listBySession as (...a: unknown[]) => Promise<unknown>
            )(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const runtime = new Proxy(rt, {
      get(target, prop, receiver) {
        if (prop === "messages") return messages;
        if (prop === "workplace" || prop === "sessionVfs") {
          return (...args: unknown[]) => {
            counts.workplace += 1;
            return (Reflect.get(target, prop, receiver) as (
              ...a: unknown[]
            ) => unknown)(...args);
          };
        }
        if (prop === "skills") {
          return (...args: unknown[]) => {
            counts.skills += 1;
            return (Reflect.get(target, prop, receiver) as (
              ...a: unknown[]
            ) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as DesktopNovelMasterRuntime;
    return { runtime, counts };
  }

  /** 第 flipAt 个检查点（1 起）起恒真。 */
  function bailAt(flipAt: number): () => boolean {
    let calls = 0;
    return () => {
      calls += 1;
      return calls >= flipAt;
    };
  }

  it("检查点①（解析 agent 之后）翻真：取消息一步都不许跑", async () => {
    const rt = await getDesktopRuntime();
    const { runtime, counts } = probeRuntime(rt);
    await assert.rejects(
      buildSessionPromptInput(
        runtime,
        { projectId, sessionId },
        undefined,
        { shouldBail: bailAt(1) },
      ),
      (error: unknown) => error instanceof ChatPromptBuildBailedError,
      "第①段弃权应抛 ChatPromptBuildBailedError",
    );
    assert.equal(counts.list, 0, "第①段弃权后不应再取可见消息");
  });

  it("检查点②（取消息之后）翻真：工作区装配不许起步", async () => {
    const rt = await getDesktopRuntime();
    const { runtime, counts } = probeRuntime(rt);
    await assert.rejects(
      buildSessionPromptInput(
        runtime,
        { projectId, sessionId },
        undefined,
        { shouldBail: bailAt(2) },
      ),
      (error: unknown) => error instanceof ChatPromptBuildBailedError,
    );
    assert.equal(counts.list, 1, "第②检查点前应已取过一次可见消息");
    assert.equal(
      counts.workplace,
      0,
      "第②段弃权后不应再取 workplace/VFS 句柄（装配未起步）",
    );
  });

  it("检查点③（工作区装配之后）翻真：prepare 段不许起步", async () => {
    const rt = await getDesktopRuntime();
    const { runtime, counts } = probeRuntime(rt);
    await assert.rejects(
      buildSessionPromptInput(
        runtime,
        { projectId, sessionId },
        undefined,
        { shouldBail: bailAt(3) },
      ),
      (error: unknown) => error instanceof ChatPromptBuildBailedError,
    );
    assert.ok(counts.workplace > 0, "第③检查点前应已装配过工作区显示");
    assert.equal(
      counts.skills,
      0,
      "第③段弃权后不应再进入 prepare 段（skills 只在 prepare 的参数里取）",
    );
  });

  it("检查点④（prepare 之后）翻真：四段足迹全见过才抛（layout 不再碰 runtime）", async () => {
    const rt = await getDesktopRuntime();
    const { runtime, counts } = probeRuntime(rt);
    await assert.rejects(
      buildSessionPromptInput(
        runtime,
        { projectId, sessionId },
        undefined,
        { shouldBail: bailAt(4) },
      ),
      (error: unknown) => error instanceof ChatPromptBuildBailedError,
    );
    // 与③的区分点：prepare 已经跑过（skills 足迹 ≥1）——④是最后一段边界，
    // 此后 layout 拼装是纯计算，不再有 runtime 足迹可数，故以「前三段 IO
    // 全部发生 + 仍抛弃权错误」钉住检查点确实落在 prepare 之后。
    assert.ok(
      counts.list >= 1 && counts.workplace >= 1 && counts.skills >= 1,
      "第④检查点前 list/workplace/skills 三段足迹都该在（证明翻真位置正确）",
    );
  });

  it("workplace 段内中止：assemble 文件粒度抛错 → build 转抛 ChatPromptBuildBailedError", async () => {
    const rt = await getDesktopRuntime();
    const project = await handleProjectsCreate({ name: "wp-bail" });
    assert.equal(project.ok, true);
    if (!project.ok) return;
    const session = await handleSessionsCreate({
      projectId: project.data.id,
      title: "wp-bail",
    });
    assert.equal(session.ok, true);
    if (!session.ok) return;
    const { projectId, sessionId } = {
      projectId: project.data.id,
      sessionId: session.data.id,
    };

    // 预置两条 full 文件的规则快照（域/键字面量与 core 常量一致），不写
    // VFS 正文 → file_cache miss → 逐文件回填（read 走 (missing) 兜底）。
    await rt.sessionKkv.set(
      sessionId,
      "rule_snapshot",
      "canon",
      serializeRuleSnapshot([
        { path: "/a.md", status: "full" },
        { path: "/b.md", status: "full" },
      ]),
    );

    // 数 vfs.read：shouldBail 在第一个文件回填后翻真，第二个文件的检查点
    // 上 assemble 抛 WorkplaceAssemblyAbortedError → build 必须转抛统一哨兵。
    let readCalls = 0;
    const realSessionVfs = rt.sessionVfs.bind(rt);
    const wrapped: typeof realSessionVfs = (pid, sid) => {
      const vfs = realSessionVfs(pid, sid);
      return new Proxy(vfs, {
        get(target, prop, receiver) {
          if (prop === "read") {
            return async (path: string) => {
              readCalls += 1;
              return target.read(path);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as ReturnType<typeof realSessionVfs>;
    };
    rt.sessionVfs = wrapped;
    try {
      const definition = buildDefaultAgentDefinitionPreservingName("wp-bail");
      definition.prompts = {
        ...definition.prompts,
        persist: [],
        dynamic: [],
        workplace: "【工作区】",
      };
      await assert.rejects(
        buildSessionPromptInput(rt, { projectId, sessionId }, definition, {
          shouldBail: () => readCalls >= 1,
        }),
        (error: unknown) => error instanceof ChatPromptBuildBailedError,
        "assemble 的文件粒度中止必须转抛成 build 的统一哨兵类",
      );
      assert.equal(readCalls, 1, "第二个文件的 read 不该发生（文件粒度检查点）");
    } finally {
      rt.sessionVfs = realSessionVfs;
    }
  });

  it("判据恒假 / 不传 options ⇒ 行为零变化（弃权检查点不许误伤）", async () => {
    const rt = await getDesktopRuntime();
    const { runtime, counts } = probeRuntime(rt);
    const bundle = await buildSessionPromptInput(
      runtime,
      { projectId, sessionId },
      undefined,
      { shouldBail: () => false },
    );
    assert.equal(bundle.rawMessages.length, 1);
    assert.ok(counts.list >= 1 && counts.workplace >= 1 && counts.skills >= 1);

    // 预览消费方（不传 options）：原签名调用零变化。
    const previewBundle = await buildSessionPromptInput(
      runtime,
      { projectId, sessionId },
    );
    assert.equal(previewBundle.rawMessages.length, 1);
  });
});
