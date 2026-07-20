import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORKPLACE_DIR_RULE } from "@novel-master/core/workplace";
import {
  emptyDirRuleForm,
  defaultDirRuleRequest,
} from "@/features/workspace/workspace-actions";

test("emptyDirRuleForm 无持久化规则时 ruleEnabled 为 false", () => {
  const form = emptyDirRuleForm("/notes", {
    workspaceScope: "chat",
    projectId: "p1",
    sessionId: "s1",
  });
  assert.equal(form.ruleEnabled, false);
  assert.equal(form.logicalPath, "/notes");
  assert.equal(form.fillPolicy, DEFAULT_WORKPLACE_DIR_RULE.fillPolicy);
});

test("defaultDirRuleRequest 新建目录持久化时 ruleEnabled 为 true", () => {
  const form = defaultDirRuleRequest("/drafts", {
    workspaceScope: "chat",
    projectId: "p1",
    sessionId: "s1",
  });
  assert.equal(form.ruleEnabled, true);
  assert.equal(form.logicalPath, "/drafts");
});
