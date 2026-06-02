import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertNoCrossRoundDoomLoop,
  assertNoDoomLoopInBlocks,
  CROSS_ROUND_WINDOW,
  DOOM_LOOP_THRESHOLD,
} from "../../src/domain/agent/logic/doom-loop.js";
import { AgentError } from "../../src/errors/agent-runtime-errors.js";

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

  it(`throws DOOM_LOOP on cross-round A-B-A-B in last ${CROSS_ROUND_WINDOW}`, () => {
    const calls = [
      { type: "tool_use" as const, id: "1", name: "vfs.read", input: { path: "/a" } },
      { type: "tool_use" as const, id: "2", name: "vfs.list", input: { dir: "/" } },
      { type: "tool_use" as const, id: "3", name: "vfs.read", input: { path: "/a" } },
      { type: "tool_use" as const, id: "4", name: "vfs.list", input: { dir: "/" } },
    ];
    assert.throws(
      () => assertNoCrossRoundDoomLoop(calls),
      (e: unknown) => e instanceof AgentError && e.code === "DOOM_LOOP",
    );
  });

  it("allows non-alternating cross-round history", () => {
    assert.doesNotThrow(() =>
      assertNoCrossRoundDoomLoop([
        { type: "tool_use", id: "1", name: "vfs.read", input: { path: "/a" } },
        { type: "tool_use", id: "2", name: "vfs.list", input: { dir: "/" } },
        { type: "tool_use", id: "3", name: "vfs.write", input: { path: "/a", content: "x" } },
        { type: "tool_use", id: "4", name: "vfs.list", input: { dir: "/" } },
      ]),
    );
  });
});
