/**
 * better-sqlite3 nested-batch parity harness (A-24).
 *
 * @module tdbc-driver-better-sqlite3/test/nested-batch-parity
 */

import { describe } from "node:test";
import { TdbcOpen } from "@novel-master/core";
import { NestedBatch } from "@novel-master/tdbc-conformance";
import {
  BetterSqlite3Register,
  BETTER_SQLITE3_DRIVER_NAME,
} from "../src/index.js";

BetterSqlite3Register.register();

NestedBatch.runParityTests({
  createConnection: async () =>
    TdbcOpen.open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    }),
});

describe("better-sqlite3 nested batch parity harness", () => {
  /* parity suite registers nested describes */
});
