/**
 * T-PB4 — desktop：physical 面板 IPC 层单测（list/read handler 行为）。
 *
 * 覆盖：
 * - list handler 正确分流到 PhysicalVfsService（跨域拼接 + 虚拟目录合成 + 行 DTO 缺省字段 + label 透传）
 * - listTree 批量拉取的 per-scope 错误隔离（NOT_FOUND 子树跳过，其余域行照常返回）
 * - read handler 五前缀解析后走对应域单 scope read
 * - 无写通道：physical 域进任何写 handler 均被 resolve-vfs-scope 拒绝；
 *   PhysicalVfsService 运行时对象无写方法。
 *
 * 注意：仅覆盖 main 进程 IPC 层，不含 renderer 面板组件渲染。
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { AppError } from "@novel-master/core/errors";
import { DesktopRuntimeSingleton } from "../src/main/runtime/desktop-runtime-singleton.js";
import { Projects } from "../src/main/ipc/handlers/projects.js";
import { AgentRegistry } from "../src/main/ipc/handlers/agent-registry.js";
import { Agent } from "../src/main/ipc/handlers/agent.js";
import { Sessions } from "../src/main/ipc/handlers/sessions.js";
import { Vfs } from "../src/main/ipc/handlers/vfs.js";
import { Physical } from "../src/main/ipc/handlers/physical.js";
import { ResolveVfsScope } from "../src/main/ipc/resolve-vfs-scope.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("physical 只读物理树 IPC（T-PB4）", () => {
  let tempDir: string;
  let projectId: string;
  let sessionId: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-desktop-physical-ipc-"));

    // 全局普通文件（global 域 → 物理前缀 /template）
    const globalWrite = await Vfs.write({
      workspaceScope: "global",
      path: "/hello.md",
      content: "global-template-content",
    });
    assert.equal(globalWrite.ok, true);

    // 全局技能文件（global-meta 域 → 物理前缀即逻辑路径，需自带 /meta 段）
    const metaWrite = await Vfs.write({
      workspaceScope: "global-meta",
      path: "/meta/skills/demo/skill.md",
      content: "global-meta-skill",
    });
    assert.equal(metaWrite.ok, true);

    // 项目 + 会话（chat 域 → /projects/{pid}/sessions/{sid}）
    const project = await Projects.create({ name: "physical-ipc" });
    assert.equal(project.ok, true);
    if (!project.ok) {
      return;
    }
    projectId = project.data.id;

    // 新 core 下 session 创建要求 workspace 已配置 agent。
    const blank = await AgentRegistry.createBlank();
    assert.equal(blank.ok, true);
    if (blank.ok) {
      await Agent.setCurrent({ agentId: blank.data.agentId });
    }

    const session = await Sessions.create({
      projectId,
      title: "physical-session",
    });
    assert.equal(session.ok, true);
    if (!session.ok) {
      return;
    }
    sessionId = session.data.id;

    const chatWrite = await Vfs.write({
      workspaceScope: "chat",
      projectId,
      sessionId,
      path: "/draft.md",
      content: "session-file-content",
    });
    assert.equal(chatWrite.ok, true, chatWrite.ok ? "" : JSON.stringify(chatWrite.error));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("list：物理根三挂载点 + 跨域文件行 + 虚拟目录合成（BFS 收敛）", async () => {
    const result = await Physical.list({ path: "/" });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const paths = result.data.map((row) => row.path);

    // 物理根：三个域挂载点合成目录行
    assert.ok(paths.includes("/template"));
    assert.ok(paths.includes("/meta"));
    assert.ok(paths.includes("/projects"));

    // 各域文件行拼接（global / global-meta / session）
    assert.ok(paths.includes("/template/hello.md"));
    assert.ok(paths.includes("/meta/skills"));
    assert.ok(paths.includes("/meta/skills/demo"));
    assert.ok(paths.includes("/meta/skills/demo/skill.md"));
    assert.ok(
      paths.includes(`/projects/${projectId}/sessions`),
      "项目会话目录行应合成",
    );
    assert.ok(
      paths.includes(`/projects/${projectId}/sessions/${sessionId}`),
      "会话目录行应合成",
    );
    assert.ok(
      paths.includes(`/projects/${projectId}/sessions/${sessionId}/draft.md`),
    );

    // 项目层三个子域挂载点（空域同样合成目录行）
    assert.ok(paths.includes(`/projects/${projectId}/template`));
    assert.ok(paths.includes(`/projects/${projectId}/meta`));

    // label 透传：项目目录行携带项目名（G-1）
    const projectRow = result.data.find(
      (row) => row.path === `/projects/${projectId}`,
    );
    assert.ok(projectRow != null, "项目目录行应存在");
    assert.equal(projectRow.kind, "dir");
    assert.ok(
      "label" in projectRow && projectRow.label === "physical-ipc",
      `项目行 label 应为项目名，实际: ${JSON.stringify(projectRow)}`,
    );
  });

  it("list：单子树 NOT_FOUND 降级为空行集，不再 ok:false 拖垮请求（B-1）", async () => {
    // 子树不存在（如项目/会话被并发删除）：跳过该子树 → 空行集 + ok:true
    const missingProject = await Physical.list({
      path: "/projects/no-such-project",
    });
    assert.equal(missingProject.ok, true);
    if (missingProject.ok) {
      assert.deepEqual(missingProject.data, []);
    }

    const missingSession = await Physical.list({
      path: `/projects/${projectId}/sessions/no-such-session`,
    });
    assert.equal(missingSession.ok, true);
    if (missingSession.ok) {
      assert.deepEqual(missingSession.data, []);
    }
  });

  it("list：某 scope 拉取抛 NOT_FOUND 时跳过该子树，其余域行照常返回（B-1）", async () => {
    const rtR = await DesktopRuntimeSingleton.get();
    if (!rtR.ok) throw rtR.error;
    const rt = rtR.value;
    // rt.physicalVfs() 每次返回新实例，注入需 wrap 工厂方法：
    // /meta scope 拉取抛 NOT_FOUND（等价于拉取期间子树被删）
    const originalFactory = rt.physicalVfs.bind(rt);
    rt.physicalVfs = () => {
      const svc = originalFactory();
      const originalListTree = svc.listTree.bind(svc);
      svc.listTree = async (physicalPath: string) => {
        if (physicalPath === "/meta") {
          // 错误通道迁移四期：listTree 已知失败沿 Result.err（不再 throw）。
          return {
            ok: false as const,
            error: new AppError("VFS_NOT_FOUND", {
              path: physicalPath,
              detail: `Path not found: ${physicalPath}`,
            }),
          };
        }
        return originalListTree(physicalPath);
      };
      return svc;
    };
    try {
      const result = await Physical.list({ path: "/" });
      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }
      const paths = result.data.map((row) => row.path);

      // 失败 scope 的子树行被跳过（挂载点根行由 handler 合成，保留）
      assert.ok(!paths.includes("/meta/skills"), "失败 scope 子树行不应返回");
      assert.ok(!paths.includes("/meta/skills/demo/skill.md"));

      // 其余域行照常返回
      assert.ok(paths.includes("/template/hello.md"));
      assert.ok(paths.includes(`/projects/${projectId}/template`));
      assert.ok(
        paths.includes(`/projects/${projectId}/sessions/${sessionId}/draft.md`),
      );
    } finally {
      rt.physicalVfs = originalFactory;
    }
  });

  it("list：行 DTO 复用 WorkplaceListRowDto，规则字段缺省", async () => {
    const result = await Physical.list({ path: "/" });
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    const dirRow = result.data.find(
      (row) => row.kind === "dir" && row.path === "/template",
    );
    assert.ok(dirRow != null);
    assert.deepEqual(dirRow, { kind: "dir", path: "/template", ruleState: "rule_off" });

    const fileRow = result.data.find((row) => row.path === "/template/hello.md");
    assert.ok(fileRow != null);
    assert.deepEqual(fileRow, {
      kind: "file",
      path: "/template/hello.md",
      inclusionMode: "auto",
      displayState: "full",
    });
  });

  it("read：前缀解析分流到对应域（/template → global；sessions/{sid} → session）", async () => {
    const globalRead = await Physical.read({ path: "/template/hello.md" });
    assert.equal(globalRead.ok, true);
    if (globalRead.ok) {
      assert.equal(globalRead.data.content, "global-template-content");
    }

    const metaRead = await Physical.read({
      path: "/meta/skills/demo/skill.md",
    });
    assert.equal(metaRead.ok, true);
    if (metaRead.ok) {
      assert.equal(metaRead.data.content, "global-meta-skill");
    }

    const sessionRead = await Physical.read({
      path: `/projects/${projectId}/sessions/${sessionId}/draft.md`,
    });
    assert.equal(sessionRead.ok, true);
    if (sessionRead.ok) {
      assert.equal(sessionRead.data.content, "session-file-content");
    }

    const missing = await Physical.read({ path: "/no-such-mount/x.md" });
    assert.equal(missing.ok, false);
  });

  it("无写通道：physical 域不解析为单 scope，写 handler 全部拒绝", async () => {
    // scope 解析层显式分流：physical 走失败返回值（而非误落任何域）
    const physicalScope = ResolveVfsScope.fromRequest({
      workspaceScope: "physical",
    });
    assert.equal(physicalScope.ok, false);
    if (!physicalScope.ok) {
      assert.equal(physicalScope.error.code, "IPC_INVALID_ARGUMENT");
    }

    // 写 handler 经 resolve 后对 physical 返回失败（不落库）
    const write = await Vfs.write({
      workspaceScope: "physical",
      path: "/template/hello.md",
      content: "tamper",
    });
    assert.equal(write.ok, false);

    // 未被篡改：内容仍为原值
    const reread = await Physical.read({ path: "/template/hello.md" });
    assert.equal(reread.ok, true);
    if (reread.ok) {
      assert.equal(reread.data.content, "global-template-content");
    }
  });

  it("无写通道：PhysicalVfsService 运行时对象无任何写方法", async () => {
    const rtR = await DesktopRuntimeSingleton.get();
    if (!rtR.ok) throw rtR.error;
    const rt = rtR.value;
    const svc = rt.physicalVfs() as unknown as Record<string, unknown>;
    for (const method of ["write", "mkdir", "delete", "rename", "move"]) {
      assert.equal(svc[method], undefined, `physicalVfs 不应存在 ${method}`);
    }
    assert.equal(typeof svc.list, "function");
    assert.equal(typeof svc.read, "function");
  });
});
