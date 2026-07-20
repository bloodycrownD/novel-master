import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapProjectWorkplacePathToSession, mapSessionWorkplacePathToProject } from "@novel-master/core/workplace";

describe("worktree path map", () => {
  it("maps project logical path to session unchanged", () => {
    assert.equal(mapProjectWorkplacePathToSession("/foo/bar"), "/foo/bar");
  });

  it("round-trips project paths", () => {
    const project = "/foo/bar";
    const session = mapProjectWorkplacePathToSession(project);
    assert.equal(mapSessionWorkplacePathToProject(session), project);
  });
});
