import assert from "node:assert/strict";
import { describe, it, mock, afterEach } from "node:test";
import {
  createSseChunkEmitter,
  DEFAULT_TICK_MS,
} from "../../../src/infra/llm-protocol/logic/sse-chunk-emitter.js";

afterEach(() => {
  mock.timers.reset();
});

describe("sse-chunk-emitter", () => {
  it("U-01: append batches into one onChunk per tick", () => {
    mock.timers.enable({ apis: ["setInterval"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    emitter.append("a");
    emitter.append("b");
    emitter.append("c");
    assert.equal(chunks.length, 0);

    mock.timers.tick(32);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], "abc");

    emitter.dispose();
  });

  it("U-02: flush returns tail and stops ticks; dispose prevents further emit", () => {
    mock.timers.enable({ apis: ["setInterval"] });

    const chunks: string[] = [];
    const emitter = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: 32,
    });

    emitter.append("leftover");
    const tail = emitter.flush();
    assert.equal(tail, "leftover");
    assert.equal(chunks.length, 0);

    emitter.append("ignored");
    mock.timers.tick(32);
    assert.equal(chunks.length, 0);

    const emitter2 = createSseChunkEmitter((chunk) => chunks.push(chunk), {
      tickMs: DEFAULT_TICK_MS,
    });
    emitter2.append("x");
    emitter2.dispose();
    mock.timers.tick(DEFAULT_TICK_MS);
    assert.equal(chunks.filter((c) => c === "x").length, 0);
  });
});
