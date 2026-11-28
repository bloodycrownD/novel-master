/**
 * MCP server 状态标签文案选择单测（mcp-server-meta.mcpStatusLabel）：
 * 各连接态应映射到正确的 i18n key——断言与同一 translator 的对应 key 文案相等
 * （key 的 zh-CN 文案互不相同，等价于钉死 key 选择），不硬编码中文比对。
 * 「已断开」（status_disconnected）此前无文案断言，本文件补齐整个状态 → key 映射。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { McpServerStatus } from "@shared/ipc-types";
import { mcpStatusLabel } from "@/features/settings/mcp-server-meta";
import { settingsTranslator } from "@/i18n/settings";

/** 最小状态 fixture（meta 只读 state / failure / toolCount）。 */
function statusOf(state: McpServerStatus["state"], extra: Partial<McpServerStatus> = {}): McpServerStatus {
    return { serverId: "a", state, ...extra };
}

describe("mcpStatusLabel 状态 → 文案 key", () => {
    it("disconnected 显示 status_disconnected（已断开），不落到 pending 兜底", () => {
        const label = mcpStatusLabel(statusOf("disconnected"));
        assert.equal(label, settingsTranslator({ key: "settings.mcp.detail.status_disconnected" }), "disconnected 应选 status_disconnected 的文案");
        assert.notEqual(label, settingsTranslator({ key: "settings.mcp.detail.status_pending" }), "不得与未连接兜底同文案");
    });

    it("其余状态各归其位：connecting / disabled / pending 选各自 key、ready 拼接工具数、failure 直显原文", () => {
        assert.equal(mcpStatusLabel(statusOf("connecting")), settingsTranslator({ key: "settings.mcp.list.connecting" }), "connecting 应选 list.connecting");
        assert.equal(mcpStatusLabel(statusOf("disabled")), settingsTranslator({ key: "settings.mcp.detail.status_disabled" }), "disabled 应选 detail.status_disabled");
        assert.equal(mcpStatusLabel(statusOf("pending")), settingsTranslator({ key: "settings.mcp.detail.status_pending" }), "pending 应选 detail.status_pending");
        const ready = mcpStatusLabel(statusOf("ready", { toolCount: 3 }));
        assert.ok(ready.startsWith(settingsTranslator({ key: "settings.mcp.list.connected" })), `ready 标签应以已连接开头：${ready}`);
        assert.ok(ready.includes("3"), `ready 标签应带工具数：${ready}`);
        assert.equal(mcpStatusLabel(statusOf("failed", { failure: { kind: "network", action: "retry", detail: "ECONNREFUSED" } })), "ECONNREFUSED", "带 failure 时直显 detail 原文，不走状态文案");
    });
});
