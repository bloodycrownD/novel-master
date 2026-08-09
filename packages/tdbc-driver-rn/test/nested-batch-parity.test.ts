/**
 * RN driver nested-batch parity harness (A-24).
 *
 * Runs against the in-memory mock adapter (backed by better-sqlite3) so it
 * executes in plain Node CI. The real quick-sqlite adapter exercises the
 * same SAVEPOINT SQL on-device; that path needs the RN runtime and is
 * validated via the device integration suite.
 *
 * @module tdbc-driver-rn/test/nested-batch-parity
 */

import { describe } from "node:test";
import { runNestedBatchParityTests } from "@novel-master/tdbc-conformance";
import { RnDriver, RN_DRIVER_NAME } from "../src/driver.js";
import { MockRnSqliteAdapter } from "./mock-adapter.js";

const driver = new RnDriver(new MockRnSqliteAdapter());

runNestedBatchParityTests({
  createConnection: async () =>
    driver.open({ filename: ":memory:", driver: RN_DRIVER_NAME }),
});

describe("rn nested batch parity harness (mock adapter, Node CI)", () => {
  /* parity suite registers nested describes */
});
