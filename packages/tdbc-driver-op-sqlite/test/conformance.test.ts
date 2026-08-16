import { describe } from "node:test";
import { clearDrivers } from "@novel-master/core/tdbc";
import { runConformanceTests } from "@novel-master/tdbc-conformance";
import { OpSqliteDriver, OPSQLITE_DRIVER_NAME } from "../src/driver.js";
import { MockOpSqliteAdapter } from "./mock-adapter.js";

const driver = new OpSqliteDriver(new MockOpSqliteAdapter());

runConformanceTests({
  createConnection: async () =>
    driver.open({ filename: ":memory:", driver: OPSQLITE_DRIVER_NAME }),
  beforeUnknownDriverTest: () => {
    clearDrivers();
  },
  afterUnknownDriverTest: () => {
    /* C11 only; other tests use injected driver directly */
  },
});

describe("op-sqlite driver conformance harness", () => {
  /* nested describes registered by runConformanceTests */
});
