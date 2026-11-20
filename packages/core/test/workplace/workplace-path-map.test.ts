import assert from "node:assert/strict";
import {  describe, it  } from "node:test";
import {  WorkplacePathMap  } from "@novel-master/core/workplace";
import {  unwrap  } from "../helpers/result-unwrap.js";

describe("worktree path map", () => {
  it("maps project logical path to session unchanged", () => {
    assert.equal(unwrap(WorkplacePathMap.mapProjectToSession("/foo/bar")), "/foo/bar");
  });

  it("round-trips project paths", () => {
    const project = "/foo/bar";
    const session = unwrap(WorkplacePathMap.mapProjectToSession(project));
    assert.equal(unwrap(WorkplacePathMap.mapSessionToProject(session)), project);
  });
});
