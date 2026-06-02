import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const distRoot = join(fileURLToPath(new URL("..", import.meta.url)), "dist");

/** Paths re-exported from dist/index.js for event-bus iteration (Metro / CLI). */
const REQUIRED_DIST_FILES = [
  "domain/events-config/model/events-config.schema.js",
  "domain/events-config/logic/default-events.js",
  "domain/compaction-conditions/model/compaction-conditions.schema.js",
  "service/events/create-event-orchestrator.js",
  "service/events/impl/actions/run-agent.handler.js",
  "infra/events/simple-event-bus.js",
] as const;

describe("core dist artifacts", () => {
  for (const rel of REQUIRED_DIST_FILES) {
    it(`dist contains ${rel}`, () => {
      assert.equal(
        existsSync(join(distRoot, rel)),
        true,
        `missing dist/${rel} — run: npm run build -w @novel-master/core`,
      );
    });
  }
});
