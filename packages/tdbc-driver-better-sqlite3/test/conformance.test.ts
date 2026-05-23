import { describe } from "node:test";
import { open } from "@novel-master/core";
import { clearDrivers } from "@novel-master/core/tdbc";
import { runConformanceTests } from "@novel-master/tdbc-conformance";
import {
  registerBetterSqlite3Driver,
  BETTER_SQLITE3_DRIVER_NAME,
} from "../src/index.js";

registerBetterSqlite3Driver();

runConformanceTests({
  createConnection: async () =>
    open("tdbc:sqlite:file::memory:", {
      driver: BETTER_SQLITE3_DRIVER_NAME,
      filename: ":memory:",
    }),
  beforeUnknownDriverTest: () => {
    clearDrivers();
  },
  afterUnknownDriverTest: () => {
    registerBetterSqlite3Driver();
  },
});

describe("better-sqlite3 driver registered", () => {
  /* conformance suite registers nested describes */
});
