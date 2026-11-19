import { describe } from "node:test";
import { TdbcOpen } from "@novel-master/core";
import { TdbcRegistry } from "@novel-master/core/tdbc";
import { runConformanceTests } from "@novel-master/tdbc-conformance";
import {
  registerBetterSqlite3Driver,
  BETTER_SQLITE3_DRIVER_NAME,
} from "../src/index.js";

registerBetterSqlite3Driver();

runConformanceTests({
  createConnection: async () =>
    TdbcOpen.open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    }),
  beforeUnknownDriverTest: () => {
    TdbcRegistry.clear();
  },
  afterUnknownDriverTest: () => {
    registerBetterSqlite3Driver();
  },
});

describe("better-sqlite3 driver registered", () => {
  /* conformance suite registers nested describes */
});
