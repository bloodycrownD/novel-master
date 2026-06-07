/**
 * P1/P2 performance thresholds for message checkpoint capture and rollback.
 *
 * Uses in-memory SQLite (same as unit tests). Thresholds match SPEC desktop targets
 * with a 4× CI slack multiplier to reduce flaky failures on slow runners.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textBlocks } from "@novel-master/core";
import type { VfsService } from "@novel-master/core";
import { openNovelMasterTestConnection } from "../helpers/novel-master.js";

const FILE_COUNT = 1000;
const SAMPLE_RUNS = 8;

/** SPEC desktop P95 capture target (ms). */
const CAPTURE_P95_MS = 200;
/** SPEC desktop P95 rollback target (ms). */
const ROLLBACK_P95_MS = 500;
/** Multiplier for CI / slow hosts (documented in spec performance section). */
const CI_SLACK = 4;

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

async function seedFiles(
  vfs: VfsService,
  count: number,
  namePrefix = "file",
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await vfs.write(`/${namePrefix}-${i}.txt`, `body-${i}`, {
      versionCheck: false,
    });
  }
}

describe("message checkpoint performance", { timeout: 180_000 }, () => {
  it("P1: capture 1000 files P95 within threshold", async () => {
    const ctx = await openNovelMasterTestConnection();
    const project = await ctx.projects.create("Perf");
    const session = await ctx.sessions.create(project.id);
    const svfs = ctx.sessionVfs(project.id, session.id);
    await seedFiles(svfs, FILE_COUNT);

    const assistant = await ctx.messages.append(session.id, "assistant", {
      blocks: [{ type: "text", text: "capture" }],
    });

    const durations: number[] = [];
    for (let run = 0; run < SAMPLE_RUNS; run++) {
      const start = performance.now();
      await ctx.messageCheckpoint.capture(session.id, project.id, assistant.id);
      durations.push(performance.now() - start);
    }

    const p95 = percentile(durations, 95);
    assert.ok(
      p95 < CAPTURE_P95_MS * CI_SLACK,
      `capture P95 ${p95.toFixed(1)}ms exceeds ${CAPTURE_P95_MS * CI_SLACK}ms`,
    );

    await ctx.conn.close();
  });

  it("P2: rollback diff 1000 files P95 within threshold", async () => {
    const ctx = await openNovelMasterTestConnection();
    const durations: number[] = [];

    for (let run = 0; run < SAMPLE_RUNS; run++) {
      const project = await ctx.projects.create(`Perf-${run}`);
      const session = await ctx.sessions.create(project.id);
      const svfs = ctx.sessionVfs(project.id, session.id);
      const prefix = `file-${run}`;
      await seedFiles(svfs, FILE_COUNT, prefix);

      const anchorAssistant = await ctx.messages.append(session.id, "assistant", {
        blocks: [{ type: "text", text: "anchor" }],
      });
      await ctx.messageCheckpoint.capture(
        session.id,
        project.id,
        anchorAssistant.id,
      );

      for (let i = 0; i < 50; i++) {
        await ctx.messages.append(session.id, "user", textBlocks(`msg ${i}`));
      }

      for (let i = 0; i < FILE_COUNT; i++) {
        await svfs.write(`/${prefix}-${i}.txt`, `mutated-${run}-${i}`, {
          versionCheck: false,
        });
      }
      const tailAssistant = await ctx.messages.append(session.id, "assistant", {
        blocks: [{ type: "text", text: "tail" }],
      });
      await ctx.messageCheckpoint.capture(
        session.id,
        project.id,
        tailAssistant.id,
      );

      const start = performance.now();
      await ctx.sessionFs.rollbackToMessage(
        session.id,
        project.id,
        anchorAssistant.id,
      );
      durations.push(performance.now() - start);
    }

    const p95 = percentile(durations, 95);
    assert.ok(
      p95 < ROLLBACK_P95_MS * CI_SLACK,
      `rollback P95 ${p95.toFixed(1)}ms exceeds ${ROLLBACK_P95_MS * CI_SLACK}ms`,
    );

    await ctx.conn.close();
  });
});
