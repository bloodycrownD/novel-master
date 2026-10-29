import assert from "node:assert/strict";
import { it } from "@jest/globals";

// 走 barrel 子路径导入，顺带锁 config-forms/agent/index.ts 的具名导出面。
import { agentModeMatchesTab } from "@/config-forms/agent";
import { DEFAULT_SUBAGENT_DEFINITION } from "@novel-master/core/agent";
import { API_KEY_STATUS_LABELS } from "@/config-forms/ui-labels";

/**
 * T-C1：mode × tab 八格判定矩阵。
 *
 * 口径：mode 未填写按 all 归一，双侧 tab 都显示；主 tab = 归一值
 * !== "subagent"；子 tab = 归一值 !== "primary"（与 subagent-tool 运行侧
 * 过滤、双端 picker 字面口径一致）。改错任一分支必红。
 */
it("agentModeMatchesTab 四态 × 两 tab 矩阵（T-C1）", () => {
  // primary 定义：仅主 tab 显示。
  assert.equal(agentModeMatchesTab("primary", "primary"), true);
  assert.equal(agentModeMatchesTab("primary", "subagent"), false);
  // subagent 定义：仅子 tab 显示。
  assert.equal(agentModeMatchesTab("subagent", "primary"), false);
  assert.equal(agentModeMatchesTab("subagent", "subagent"), true);
  // all 定义：双侧 tab 都显示。
  assert.equal(agentModeMatchesTab("all", "primary"), true);
  assert.equal(agentModeMatchesTab("all", "subagent"), true);
  // 未填写（undefined）：按 all 归一，双侧都显示。
  assert.equal(agentModeMatchesTab(undefined, "primary"), true);
  assert.equal(agentModeMatchesTab(undefined, "subagent"), true);
});

/**
 * T-C2：DEFAULT_SUBAGENT_DEFINITION 经 /agent 公开子路径可导入且内容不漂移。
 */
it("DEFAULT_SUBAGENT_DEFINITION 为虚拟 general 子代理（T-C2）", () => {
  assert.equal(DEFAULT_SUBAGENT_DEFINITION.name, "general");
  assert.equal(DEFAULT_SUBAGENT_DEFINITION.mode, "subagent");
});

// 原 core test/config-forms/ui-labels.test.ts 的 API_KEY_STATUS_LABELS 断言
// 随表单层迁两端（AGENT_LIST_LABELS 断言留在 core stored-config-validity 测试）。
it("API_KEY_STATUS_LABELS 映射 set/notSet 为中文", () => {
  assert.equal(API_KEY_STATUS_LABELS.set, "已连接");
  assert.equal(API_KEY_STATUS_LABELS.notSet, "未连接");
});
