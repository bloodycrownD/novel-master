import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapProjectWorkplacePathToSession, mapSessionWorkplacePathToProject } from "@novel-master/core/workplace";
import { unwrap } from "../helpers/result-unwrap.js";

describe("worktree path map", () => {
  it("maps project logical path to session unchanged", () => {
    assert.equal(unwrap(mapProjectWorkplacePathToSession("/foo/bar")), "/foo/bar");
  });

  it("round-trips project paths", () => {
    const project = "/foo/bar";
    const session = unwrap(mapProjectWorkplacePathToSession(project));
    assert.equal(unwrap(mapSessionWorkplacePathToProject(session)), project);
  });
});
