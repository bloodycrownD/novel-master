import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapProjectWorktreePathToSession,
  mapSessionWorktreePathToProject,
} from "@novel-master/core";

describe("worktree path map", () => {
  it("maps /template to session root", () => {
    assert.equal(mapProjectWorktreePathToSession("/template"), "/");
  });

  it("maps /template/a to /a", () => {
    assert.equal(mapProjectWorktreePathToSession("/template/a"), "/a");
  });

  it("round-trips project paths", () => {
    const project = "/template/foo/bar";
    const session = mapProjectWorktreePathToSession(project);
    assert.equal(mapSessionWorktreePathToProject(session), project);
  });

  it("rejects non-template project paths", () => {
    assert.throws(() => mapProjectWorktreePathToSession("/other"));
  });
});
