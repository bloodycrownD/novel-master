import { describe } from "node:test";
import { clearDrivers } from "@novel-master/core/tdbc";
import { runConformanceTests } from "@novel-master/tdbc-conformance";
import { RnDriver, RN_DRIVER_NAME } from "../src/driver.js";
import { MockRnSqliteAdapter } from "./mock-adapter.js";

const driver = new RnDriver(new MockRnSqliteAdapter());

runConformanceTests({
  createConnection: async () =>
    driver.open({ filename: ":memory:", driver: RN_DRIVER_NAME }),
  beforeUnknownDriverTest: () => {
    clearDrivers();
  },
  afterUnknownDriverTest: () => {
    /* C11 only; other tests use injected driver directly */
  },
});

describe("rn driver conformance harness", () => {
  /* nested describes registered by runConformanceTests */
});
