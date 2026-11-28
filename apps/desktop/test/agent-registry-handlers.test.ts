import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { join } from "node:path";
import { dialog } from "electron";
import { AgentYamlCodec } from "@novel-master/core/agent";
import { DesktopRuntimeSingleton } from "../src/main/runtime/desktop-runtime-singleton.js";
import { DesktopRuntimeFactory } from "../src/main/runtime/create-desktop-runtime.js";
import { AgentRegistry } from "../src/main/ipc/handlers/agent-registry.js";
import {
    setupDesktopDbTestEnv,
    teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

describe("agent-registry IPC handlers", () => {
    let tempDir: string;

    before(async () => {
        ({ tempDir } = await setupDesktopDbTestEnv("nm-agent-registry-"));
    });

    after(async () => {
        await teardownDesktopDbTestEnv(tempDir);
    });

    it("list 对单条失效 wire 返回 invalid 且保留其余行", async () => {
        const created = await AgentRegistry.createBlank();
        assert.equal(created.ok, true);
        if (!created.ok) {
            return;
        }

        // 错误通道迁移七期后 runtime 工厂返回 Result，解包取实体。
        const rtR = await DesktopRuntimeFactory.create();
        if (!rtR.ok) throw rtR.error;
        const rt = rtR.value;
        const now = Date.now();
        const brokenWire = {
            schemaVersion: 1,
            name: "broken",
            prompts: { blocks: {} },
        };
        await rt.conn.execute(
            `INSERT INTO agent_definition ( agent_id, prompts_json, created_at_ms, updated_at_ms )
    VALUES (?, ?, ?, ?)`,
            ["broken-agent", JSON.stringify(brokenWire), now, now],
        );
        await DesktopRuntimeSingleton.resetForTest();

        const listed = await AgentRegistry.list();
        assert.equal(listed.ok, true);
        if (!listed.ok) {
            return;
        }

        const broken = listed.data.find((row) => row.agentId === "broken-agent");
        assert.ok(broken);
        assert.equal(broken!.name, "broken");
        assert.ok(broken!.invalid);
        assert.equal(broken!.invalid!.code, "removed_feature");
        assert.match(broken!.invalid!.message, /prompts\.blocks/);
        assert.equal(broken!.decodeError, broken!.invalid!.message);

        const healthy = listed.data.find((row) => row.agentId === created.data.agentId);
        assert.ok(healthy);
        assert.equal(healthy!.invalid, undefined);
        assert.equal(healthy!.decodeError, undefined);
        assert.equal(listed.data.length, 2);
    });

    it("get 返回 assessed StoredConfigHealthDto（valid）", async () => {
        const created = await AgentRegistry.createBlank();
        assert.equal(created.ok, true);
        if (!created.ok) {
            return;
        }

        const got = await AgentRegistry.get({ agentId: created.data.agentId });
        assert.equal(got.ok, true);
        if (!got.ok) {
            return;
        }
        assert.equal(got.data.status, "valid");
        assert.ok(got.data.wire);
        if (got.data.status === "valid") {
            assert.ok(typeof got.data.value.name === "string");
            assert.ok(got.data.value.name.length > 0);
        }
    });

    it("get 对失效 wire 返回 assessed invalid", async () => {
        // 错误通道迁移七期后 runtime 工厂返回 Result，解包取实体。
        const rtR = await DesktopRuntimeFactory.create();
        if (!rtR.ok) throw rtR.error;
        const rt = rtR.value;
        const now = Date.now();
        const brokenWire = {
            schemaVersion: 1,
            name: "broken-get",
            prompts: { blocks: {} },
        };
        await rt.conn.execute(
            `INSERT INTO agent_definition ( agent_id, prompts_json, created_at_ms, updated_at_ms )
    VALUES (?, ?, ?, ?)`,
            ["broken-get-agent", JSON.stringify(brokenWire), now, now],
        );
        await DesktopRuntimeSingleton.resetForTest();

        const got = await AgentRegistry.get({ agentId: "broken-get-agent" });
        assert.equal(got.ok, true);
        if (!got.ok) {
            return;
        }
        assert.equal(got.data.status, "invalid");
        assert.deepEqual(got.data.wire, brokenWire);
        if (got.data.status === "invalid") {
            assert.equal(got.data.code, "removed_feature");
        }
    });
});

describe("agent-registry mode 透传（agent-config-tabs T-D1/T-D2）", () => {
    let tempDir: string;

    before(async () => {
        ({ tempDir } = await setupDesktopDbTestEnv("nm-agent-registry-mode-"));
    });

    after(async () => {
        await teardownDesktopDbTestEnv(tempDir);
    });

    it("T-D1：list valid 行带出 mode 三档各一；mode 缺省 valid 行无 mode 字段；invalid 行无 mode", async () => {
        // createBlank 的 agentId 为 `agent-<Date.now()>`，间隔数毫秒防同毫秒撞 id。
        const primary = await AgentRegistry.createBlank({ mode: "primary" });
        assert.equal(primary.ok, true);
        await new Promise((r) => setTimeout(r, 5));
        const subagent = await AgentRegistry.createBlank({ mode: "subagent" });
        assert.equal(subagent.ok, true);
        await new Promise((r) => setTimeout(r, 5));
        const all = await AgentRegistry.createBlank({ mode: "all" });
        assert.equal(all.ok, true);
        await new Promise((r) => setTimeout(r, 5));
        const blank = await AgentRegistry.createBlank();
        assert.equal(blank.ok, true);
        if (!primary.ok || !subagent.ok || !all.ok || !blank.ok) {
            return;
        }

        // invalid 行（removed_feature）直接落库，读不出定义 → 天然无 mode。
        // 错误通道迁移七期后 runtime 工厂返回 Result，解包取实体。
        const rtR = await DesktopRuntimeFactory.create();
        if (!rtR.ok) throw rtR.error;
        const rt = rtR.value;
        const now = Date.now();
        await rt.conn.execute(
            `INSERT INTO agent_definition ( agent_id, prompts_json, created_at_ms, updated_at_ms )
    VALUES (?, ?, ?, ?)`,
            [
                "broken-mode-agent",
                JSON.stringify({
                    schemaVersion: 1,
                    name: "broken-mode",
                    prompts: { blocks: {} },
                }),
                now,
                now,
            ],
        );
        await DesktopRuntimeSingleton.resetForTest();

        const listed = await AgentRegistry.list();
        assert.equal(listed.ok, true);
        if (!listed.ok) {
            return;
        }

        const primaryRow = listed.data.find(
            (r) => r.agentId === primary.data.agentId,
        );
        assert.ok(primaryRow);
        assert.equal(primaryRow!.mode, "primary");

        const subagentRow = listed.data.find(
            (r) => r.agentId === subagent.data.agentId,
        );
        assert.ok(subagentRow);
        assert.equal(subagentRow!.mode, "subagent");

        const allRow = listed.data.find((r) => r.agentId === all.data.agentId);
        assert.ok(allRow);
        assert.equal(allRow!.mode, "all");

        // mode 缺省的 valid 行：响应体不含 mode 字段（未填写 = 双边显示语义）。
        const blankRow = listed.data.find(
            (r) => r.agentId === blank.data.agentId,
        );
        assert.ok(blankRow);
        assert.equal(blankRow!.mode, undefined);
        assert.equal("mode" in blankRow!, false);

        const brokenRow = listed.data.find(
            (r) => r.agentId === "broken-mode-agent",
        );
        assert.ok(brokenRow);
        assert.ok(brokenRow!.invalid);
        assert.equal("mode" in brokenRow!, false);
    });

    it("T-D2：createBlank 带 mode 落库 wire 含 mode；不传 payload 落库无 mode（现行为回归）", async () => {
        const sub = await AgentRegistry.createBlank({ mode: "subagent" });
        assert.equal(sub.ok, true);
        if (!sub.ok) {
            return;
        }
        // 错误通道迁移七期后 runtime 工厂返回 Result，解包取实体。
        const rtR = await DesktopRuntimeFactory.create();
        if (!rtR.ok) throw rtR.error;
        const rt = rtR.value;
        const subRows = await rt.conn.query<{ prompts_json: string }>(
            `SELECT prompts_json FROM agent_definition WHERE agent_id = ?`,
            [sub.data.agentId],
        );
        await DesktopRuntimeSingleton.resetForTest();
        assert.equal(subRows.length, 1);
        const subWire = JSON.parse(
            String(subRows[0]!.prompts_json),
        ) as Record<string, unknown>;
        assert.equal(subWire.mode, "subagent");

        await new Promise((r) => setTimeout(r, 5));
        const plain = await AgentRegistry.createBlank();
        assert.equal(plain.ok, true);
        if (!plain.ok) {
            return;
        }
        // 错误通道迁移七期后 runtime 工厂返回 Result，解包取实体。
        const rt2R = await DesktopRuntimeFactory.create();
        if (!rt2R.ok) throw rt2R.error;
        const rt2 = rt2R.value;
        const plainRows = await rt2.conn.query<{ prompts_json: string }>(
            `SELECT prompts_json FROM agent_definition WHERE agent_id = ?`,
            [plain.data.agentId],
        );
        await DesktopRuntimeSingleton.resetForTest();
        assert.equal(plainRows.length, 1);
        const plainWire = JSON.parse(
            String(plainRows[0]!.prompts_json),
        ) as Record<string, unknown>;
        assert.equal("mode" in plainWire, false);
    });
});

describe("agent-registry YAML 导入导出（mcp 工具往返）", () => {
    let tempDir: string;
    const originalShowSaveDialog = dialog.showSaveDialog;
    const originalShowOpenDialog = dialog.showOpenDialog;

    before(async () => {
        ({ tempDir } = await setupDesktopDbTestEnv("nm-agent-registry-yaml-"));
    });

    after(async () => {
        dialog.showSaveDialog = originalShowSaveDialog;
        dialog.showOpenDialog = originalShowOpenDialog;
        await teardownDesktopDbTestEnv(tempDir);
    });

    /** 与 encode(toWire) 应产出内容一致的手写 YAML（wire 形态）。 */
    const MCP_TOOLS_YAML = `schemaVersion: 1
name: mcp-agent
prompts:
  persistEnabled: false
  dynamicEnabled: false
  persist: {}
  dynamic: {}
tools:
  allow:
    - search
    - mcp
    - curl
`;

    const PLAIN_TOOLS_YAML = `schemaVersion: 1
name: plain-agent
prompts:
  persistEnabled: false
  dynamicEnabled: false
  persist: {}
  dynamic: {}
tools:
  allow:
    - search
    - curl
`;

    /** 经 AgentRegistry.upsert 落一个带 tools.allow 的智能体定义。 */
    async function upsertWithTools(
        agentId: string,
        allow: readonly string[],
    ): Promise<void> {
        const saved = await AgentRegistry.upsert({
            agentId,
            definition: {
                name: agentId,
                prompts: { persist: [], dynamic: [] },
                tools: { allow: [...allow] },
            },
        });
        if (!saved.ok) {
            assert.fail(`upsert failed: ${JSON.stringify(saved.error)}`);
        }
    }

    /** 经 AgentRegistry.exportYaml 导出 YAML 文本（保存框目标固定在 tempDir）。 */
    async function exportYamlText(agentId: string): Promise<string> {
        const outPath = join(tempDir, `${agentId}.export.yaml`);
        dialog.showSaveDialog = (async () => ({
            canceled: false,
            filePath: outPath,
        })) as typeof dialog.showSaveDialog;
        const exported = await AgentRegistry.exportYaml({ agentId });
        if (!exported.ok) {
            assert.fail(`exportYaml failed: ${JSON.stringify(exported.error)}`);
        }
        assert.equal(exported.data, "saved");
        return readFile(outPath, "utf8");
    }

    /** 把 YAML 文本放进 tempDir 并让打开对话框指向它。 */
    async function stageImportFile(
        name: string,
        yaml: string,
    ): Promise<string> {
        const importPath = join(tempDir, name);
        await writeFile(importPath, yaml, "utf8");
        dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths: [importPath],
        })) as typeof dialog.showOpenDialog;
        return importPath;
    }

    /** 读回目标智能体落库 wire 的 tools.allow。 */
    async function readWireToolsAllow(
        agentId: string,
    ): Promise<readonly string[] | undefined> {
        const got = await AgentRegistry.get({ agentId });
        if (!got.ok) {
            assert.fail(`get failed: ${JSON.stringify(got.error)}`);
        }
        const wire = got.data.wire as { tools?: { allow?: string[] } };
        return wire.tools?.allow;
    }

    it("导出：tools.allow 含 mcp 的智能体导出后 mcp 在 tools 下且可再解码", async () => {
        await upsertWithTools("yaml-mcp-src", ["search", "mcp", "curl"]);
        const yaml = await exportYamlText("yaml-mcp-src");
        assert.match(yaml, /mcp/);
        // 编解码单源在 core：导出物必须能被真实 decode 还原 tools.allow。
        const decoded = AgentYamlCodec.decode(yaml);
        if (!decoded.ok) {
            assert.fail(`decode failed: ${decoded.error.message}`);
        }
        assert.deepEqual(decoded.value.tools?.allow, [
            "search",
            "mcp",
            "curl",
        ]);
    });

    it("导入：mcp 与其余工具按原顺序落库（registeredToolNames 含 mcp 占位）", async () => {
        // 导入侧先用手写 wire YAML 锁行为：导出侧 encode 目前带 Result 信封
        // （生产缺陷，见上方导出用例），修复后与导出用例合起来即完整往返。
        await stageImportFile("yaml-mcp.import.yaml", MCP_TOOLS_YAML);
        const imported = await AgentRegistry.importYaml({
            agentId: "yaml-mcp-dst",
        });
        if (!imported.ok) {
            assert.fail(`importYaml failed: ${JSON.stringify(imported.error)}`);
        }
        assert.equal(imported.data, "imported");
        assert.deepEqual(await readWireToolsAllow("yaml-mcp-dst"), [
            "search",
            "mcp",
            "curl",
        ]);
    });

    it("导入：不含 mcp 的定义落库后不凭空多出 mcp", async () => {
        await stageImportFile("yaml-plain.import.yaml", PLAIN_TOOLS_YAML);
        const imported = await AgentRegistry.importYaml({
            agentId: "yaml-plain-dst",
        });
        if (!imported.ok) {
            assert.fail(`importYaml failed: ${JSON.stringify(imported.error)}`);
        }
        assert.deepEqual(await readWireToolsAllow("yaml-plain-dst"), [
            "search",
            "curl",
        ]);
    });

    it("导入：tools 未知工具名仍被拒绝（放开 mcp 没有把校验放松成什么都收）", async () => {
        await stageImportFile(
            "yaml-unknown.import.yaml",
            `schemaVersion: 1
name: unknown-tool-agent
prompts: {}
tools:
  allow:
    - search
    - no_such_tool_xyz
`,
        );
        const imported = await AgentRegistry.importYaml({
            agentId: "yaml-unknown-dst",
        });
        assert.equal(imported.ok, false);
        if (imported.ok) return;
        assert.match(imported.error.message, /unknown tool: no_such_tool_xyz/);
        // 拒绝路径不落库：目标 agentId 不存在。
        const got = await AgentRegistry.get({ agentId: "yaml-unknown-dst" });
        assert.equal(got.ok, false);
    });
});
