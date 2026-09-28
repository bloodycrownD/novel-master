import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewPath = path.join(
  __dirname,
  "..",
  "renderer",
  "features",
  "settings",
  "WorkspaceSettingsView.tsx",
);

// subagent-stream-toggle Step 4（T-D2）：源码断言「子会话流式」开关行存在且接线完整。
describe("WorkspaceSettingsView subagentStream 开关（T-D2）", () => {
  const source = readFileSync(viewPath, "utf8");

  it("SettingsSwitchRow「子会话流式」行存在并带静态 desc", () => {
    assert.match(
      source,
      /<SettingsSwitchRow\s+label="子会话流式"\s+desc="子智能体会话的实时输出；关闭后回复完成后一次性显示"/,
    );
  });

  it("state 初值 true 并接线 get/set 两个 invoke", () => {
    assert.match(
      source,
      /const \[subagentStream, setSubagentStream\] = useState\(true\)/,
    );
    assert.match(source, /ipcPreferencesGetSubagentStream\(\)/);
    assert.match(source, /ipcPreferencesSetSubagentStream\(next\)/);
  });

  it("「子会话流式」紧邻「父会话流式」之后", () => {
    const llmIdx = source.indexOf('label="父会话流式"');
    const subIdx = source.indexOf('label="子会话流式"');
    assert.ok(llmIdx >= 0, "「父会话流式」行缺失");
    assert.ok(subIdx > llmIdx, "「子会话流式」应位于「父会话流式」之后");
  });
});
