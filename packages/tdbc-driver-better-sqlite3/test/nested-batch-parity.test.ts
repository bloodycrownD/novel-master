/**
 * better-sqlite3 nested-batch parity harness (A-24).
 *
 * @module tdbc-driver-better-sqlite3/test/nested-batch-parity
 */

import { describe } from "node:test";
import { open } from "@novel-master/core";
import { runNestedBatchParityTests } from "@novel-master/tdbc-conformance";
import {
  registerBetterSqlite3Driver,
  BETTER_SQLITE3_DRIVER_NAME,
} from "../src/index.js";

registerBetterSqlite3Driver();

runNestedBatchParityTests({
  createConnection: async () =>
    open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    }),
});

describe("better-sqlite3 nested batch parity harness", () => {
  /* parity suite registers nested describes */
});
