import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapProjectWorktreePathToSession,
  mapSessionWorktreePathToProject,
} from "@novel-master/core";

describe("worktree path map", () => {
  it("maps project logical path to session unchanged", () => {
    assert.equal(mapProjectWorktreePathToSession("/foo/bar"), "/foo/bar");
  });

  it("round-trips project paths", () => {
    const project = "/foo/bar";
    const session = mapProjectWorktreePathToSession(project);
    assert.equal(mapSessionWorktreePathToProject(session), project);
  });
});
