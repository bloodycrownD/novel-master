import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentError,
  assertNoDoomLoopInBlocks,
  DOOM_LOOP_THRESHOLD,
} from "@novel-master/core";

describe("doom-loop", () => {
  it(`throws DOOM_LOOP after ${DOOM_LOOP_THRESHOLD} identical tool_use blocks`, () => {
    const input = { path: "/x" };
    const blocks = Array.from({ length: DOOM_LOOP_THRESHOLD }, (_, i) => ({
      type: "tool_use" as const,
      id: `id${i}`,
      name: "vfs.read",
      input,
    }));
    assert.throws(
      () => assertNoDoomLoopInBlocks(blocks),
      (e: unknown) => e instanceof AgentError && e.code === "DOOM_LOOP",
    );
  });

  it("allows two identical tool_use blocks", () => {
    const input = { path: "/x" };
    assert.doesNotThrow(() =>
      assertNoDoomLoopInBlocks([
        { type: "tool_use", id: "1", name: "vfs.read", input },
        { type: "tool_use", id: "2", name: "vfs.read", input },
      ]),
    );
  });

  it("allows three tool_use with different inputs", () => {
    assert.doesNotThrow(() =>
      assertNoDoomLoopInBlocks([
        { type: "tool_use", id: "1", name: "vfs.read", input: { path: "/a" } },
        { type: "tool_use", id: "2", name: "vfs.read", input: { path: "/b" } },
        { type: "tool_use", id: "3", name: "vfs.read", input: { path: "/c" } },
      ]),
    );
  });
});
