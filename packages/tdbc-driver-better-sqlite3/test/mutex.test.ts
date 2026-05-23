import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AsyncMutex } from "../src/mutex.js";

describe("AsyncMutex", () => {
  it("serializes concurrent tasks", async () => {
    const mutex = new AsyncMutex();
    const order: number[] = [];

    const first = mutex.run(async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 20));
      order.push(2);
    });

    const second = mutex.run(async () => {
      order.push(3);
    });

    await Promise.all([first, second]);
    assert.deepEqual(order, [1, 2, 3]);
  });
});
