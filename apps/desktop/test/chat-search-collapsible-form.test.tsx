/**
 * T-CF5：ChatHistorySearchPanel 源码契约——filter-card 折叠表单与摘要逻辑存在，
 *        且 ipcMessagesSearch / MessageList / 未找到匹配的聊天记录 三个被
 *        session-detail-drawer.test.ts 正则锁定的字符串原样保留。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(__dirname, "..", "renderer");

function readPanel(): string {
  return readFileSync(
    join(rendererRoot, "features", "chat", "ChatHistorySearchPanel.tsx"),
    "utf8",
  );
}

describe("ChatHistorySearchPanel 折叠表单 (T-CF5)", () => {
  it("源码：filter-card 折叠（button 切换 + 条件渲染）+ 成功自动收起 + 摘要", () => {
    const src = readPanel();
    // 折叠卡片容器与切换按钮（不用受控 details）
    assert.match(src, /chat-history-search__filter-card/);
    assert.match(src, /chat-history-search__filter-toggle/);
    assert.doesNotMatch(src, /<details/);
    // 展开态条件渲染表单
    assert.match(src, /\{formExpanded \? \(\s*<form/);
    // 查询命中自动收起（首次且非 append 且有结果）
    assert.match(src, /batch\.length > 0[\s\S]*?setFormExpanded\(false\)/);
    assert.match(src, /if \(append\)/);
    // 收起态摘要从筛选项 state 派生
    assert.match(src, /未设置筛选条件/);
    assert.match(src, /filterSummary/);
  });

  it("源码：三个被 session-detail-drawer.test.ts 锁定的字符串原样保留", () => {
    const src = readPanel();
    assert.match(src, /ipcMessagesSearch/);
    assert.match(src, /MessageList/);
    assert.match(src, /未找到匹配的聊天记录/);
  });
});
