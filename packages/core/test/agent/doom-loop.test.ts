import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DoomLoopDetector } from "../../src/domain/agent/logic/doom-loop.js";
import { AppError } from "../../src/errors/app-error.js";
import type { Result } from "../../src/errors/either.js";

/** 造一个 tool_use 内容块；检测只看 name + input，id 不影响判定。 */
function tu(name: string, input: Record<string, unknown>) {
  return { type: "tool_use" as const, id: `${name}-id`, name, input };
}

function isDoomLoop(e: unknown): boolean {
  return e instanceof AppError && e.key === "AGENT_DOOM_LOOP";
}

/** 取出 Err 载荷前先断言失败分支（兼证 checkStep 不抛）。 */
function expectErr(result: Result<void, AppError>): AppError {
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected Err");
  }
  return result.error;
}

function expectOk(result: Result<void, AppError>): void {
  assert.equal(result.ok, true);
}

describe("DoomLoopDetector", () => {
  it(`returns Err after ${DoomLoopDetector.DEFAULT_THRESHOLD} identical tool_use blocks`, () => {
    const input = { path: "/x" };
    const detector = new DoomLoopDetector();
    const result = detector.checkStep(
      Array.from({ length: DoomLoopDetector.DEFAULT_THRESHOLD }, () =>
        tu("read", input)
      )
    );
    assert.ok(isDoomLoop(expectErr(result)));
  });

  it("returns Ok for two identical tool_use blocks", () => {
    const input = { path: "/x" };
    const detector = new DoomLoopDetector();
    expectOk(detector.checkStep([tu("read", input), tu("read", input)]));
  });

  it("returns Ok for three tool_use with different inputs", () => {
    const detector = new DoomLoopDetector();
    expectOk(
      detector.checkStep([
        tu("read", { path: "/a" }),
        tu("read", { path: "/b" }),
        tu("read", { path: "/c" }),
      ])
    );
  });

  it("only inspects the tail window when earlier blocks differ", () => {
    const same = { path: "/x" };
    const detector = new DoomLoopDetector();
    const result = detector.checkStep([
      tu("read", { path: "/a" }),
      tu("read", { path: "/b" }),
      tu("read", same),
      tu("read", same),
      tu("read", same),
    ]);
    assert.ok(isDoomLoop(expectErr(result)));
  });

  it(`returns Err on cross-round A-B-A-B in last ${DoomLoopDetector.DEFAULT_CROSS_ROUND_WINDOW}`, () => {
    const detector = new DoomLoopDetector();
    const read = () => detector.checkStep([tu("read", { path: "/a" })]);
    const list = () => detector.checkStep([tu("list", { dir: "/" })]);
    expectOk(read());
    expectOk(list());
    expectOk(read());
    assert.ok(isDoomLoop(expectErr(list())));
  });

  it("names both alternating tools and the window in the error message", () => {
    const detector = new DoomLoopDetector();
    const steps = ["read", "list", "read", "list"] as const;
    const last = steps[steps.length - 1]!;
    for (const name of steps.slice(0, -1)) {
      expectOk(detector.checkStep([tu(name, { path: `/${name}` })]));
    }
    const error = expectErr(detector.checkStep([tu(last, { path: `/${last}` })]));
    assert.ok(isDoomLoop(error));
    assert.match(error.message, /"read" and "list"/);
    assert.match(error.message, /last 4 calls/);
  });

  it("accumulates tool_use across steps inside one instance", () => {
    const detector = new DoomLoopDetector();
    expectOk(
      detector.checkStep([tu("read", { path: "/a" }), tu("list", { dir: "/" })])
    );
    expectOk(detector.checkStep([tu("read", { path: "/a" })]));
    assert.ok(isDoomLoop(expectErr(detector.checkStep([tu("list", { dir: "/" })]))));
  });

  it("returns Ok for non-alternating cross-round history", () => {
    const detector = new DoomLoopDetector();
    expectOk(detector.checkStep([tu("read", { path: "/a" })]));
    expectOk(detector.checkStep([tu("list", { dir: "/" })]));
    expectOk(detector.checkStep([tu("write", { path: "/a", content: "x" })]));
    expectOk(detector.checkStep([tu("list", { dir: "/" })]));
  });

  it("uses configured threshold and reports it in the message", () => {
    const input = { path: "/x" };
    const detector = new DoomLoopDetector({ doomLoopThreshold: 2 });
    const error = expectErr(
      detector.checkStep([tu("read", input), tu("read", input)])
    );
    assert.ok(isDoomLoop(error));
    assert.match(error.message, /invoked 2 times/);
  });

  it("uses configured cross-round window", () => {
    const detector = new DoomLoopDetector({ doomLoopCrossRoundWindow: 6 });
    const read = () => detector.checkStep([tu("read", { path: "/a" })]);
    const list = () => detector.checkStep([tu("list", { dir: "/" })]);
    expectOk(read());
    expectOk(list());
    expectOk(read());
    expectOk(list());
    expectOk(read());
    assert.ok(isDoomLoop(expectErr(list())));
  });

  it("silently disables cross-round check for non-even windows below 4", () => {
    const detector = new DoomLoopDetector({ doomLoopCrossRoundWindow: 3 });
    expectOk(detector.checkStep([tu("read", { path: "/a" })]));
    expectOk(detector.checkStep([tu("list", { dir: "/" })]));
    expectOk(detector.checkStep([tu("read", { path: "/a" })]));
    expectOk(detector.checkStep([tu("list", { dir: "/" })]));
    expectOk(detector.checkStep([tu("read", { path: "/a" })]));
    expectOk(detector.checkStep([tu("list", { dir: "/" })]));
  });

  it("reset clears the trajectory", () => {
    const detector = new DoomLoopDetector();
    expectOk(detector.checkStep([tu("read", { path: "/a" })]));
    expectOk(detector.checkStep([tu("list", { dir: "/" })]));
    expectOk(detector.checkStep([tu("read", { path: "/a" })]));
    detector.reset();
    expectOk(detector.checkStep([tu("list", { dir: "/" })]));
  });
});
