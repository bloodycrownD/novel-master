/**
 * op-sqlite 驱动嵌套 batch parity 套件（A-24）。
 *
 * 在内存 mock adapter（better-sqlite3）上运行，纯 Node CI 即可执行。
 * 真实 op-sqlite adapter 在真机上跑同样的 SAVEPOINT SQL；该路径需要
 * RN 运行时，由真机集成验证覆盖。
 *
 * @module tdbc-driver-op-sqlite/test/nested-batch-parity
 */

import { describe } from "node:test";
import { runNestedBatchParityTests } from "@novel-master/tdbc-conformance";
import { OpSqliteDriver, OPSQLITE_DRIVER_NAME } from "../src/driver.js";
import { MockOpSqliteAdapter } from "./mock-adapter.js";

const driver = new OpSqliteDriver(new MockOpSqliteAdapter());

runNestedBatchParityTests({
  createConnection: async () =>
    driver.open({ filename: ":memory:", driver: OPSQLITE_DRIVER_NAME }),
});

describe("op-sqlite nested batch parity harness (mock adapter, Node CI)", () => {
  /* parity suite registers nested describes */
});
