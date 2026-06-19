import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flushAgentStepUi,
  flushRunUi,
} from "@/features/chat/flush-run-ui";

describe("flush-run-ui (desktop)", () => {
  it("flushAgentStepUi reloads then clears stream only after assistant phase", async () => {
    const order: string[] = [];
    const reset = () => order.push("reset");
    const reload = async () => {
      order.push("reload");
    };

    await flushAgentStepUi("tool_results", reload, reset);
    assert.deepEqual(order, ["reload"]);

    order.length = 0;
    await flushAgentStepUi("assistant", reload, reset);
    assert.deepEqual(order, ["reload", "reset"]);
  });

  it("flushRunUi always resets after reload", async () => {
    const order: string[] = [];
    await flushRunUi(
      async () => {
        order.push("reload");
      },
      () => order.push("reset"),
    );
    assert.deepEqual(order, ["reload", "reset"]);
  });
});
