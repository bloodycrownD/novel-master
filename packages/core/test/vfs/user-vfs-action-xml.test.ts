/** user-vfs-action-xml codec 单测。 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUserVfsActionXml, parseUserVfsActionsFromText } from "../../src/domain/vfs/logic/user-vfs-action-xml.js";

describe("user-vfs-action-xml", () => {
  it("build → parse round-trip，保留特殊字符与换行", () => {
    const params = { path: "/a.md", oldString: "a < b & c </action>", newString: "x\ny" };
    const xml = buildUserVfsActionXml("edit", params);
    const [action] = parseUserVfsActionsFromText(`<system-message>\n${xml}\n</system-message>`);
    assert.equal(action?.name, "edit");
    assert.deepEqual(action?.params, params);
  });

  it("多个 action 保持顺序，自闭合按空参数", () => {
    const text = `${buildUserVfsActionXml("delete", { path: "/a.md" })}\n<action name="mkdir"/>`;
    const actions = parseUserVfsActionsFromText(text);
    assert.deepEqual(actions.map((action) => action.name), ["delete", "mkdir"]);
    assert.deepEqual(actions[1]?.params, {});
  });

  it("容忍历史非法 XML：正文裸 & 与 <tag>", () => {
    const actions = parseUserVfsActionsFromText('<action name="write">\n{"path":"/a.md","content":"hello & world <tag>"}\n</action>');
    assert.equal(actions[0]?.params.content, "hello & world <tag>");
  });

  it("非法 JSON 按空参数处理；未知 entity 原样保留", () => {
    const actions = parseUserVfsActionsFromText('<action name="edit">\nnot json &unknown;\n</action>');
    assert.deepEqual(actions, [{ name: "edit", attrs: { name: "edit" }, params: {} }]);
  });

  it("属性 entity 解码", () => {
    const actions = parseUserVfsActionsFromText('<action name="edit" data-x="a&amp;b"/>');
    assert.equal(actions[0]?.attrs["data-x"], "a&b");
  });
});
