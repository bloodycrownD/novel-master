import { describe } from "node:test";
import { TdbcOpen } from "@novel-master/core";
import { TdbcRegistry } from "@novel-master/core/tdbc";
import { ConformanceSuite } from "@novel-master/tdbc-conformance";
import {
    BetterSqlite3Register,
    BETTER_SQLITE3_DRIVER_NAME,
} from "../src/index.js";

BetterSqlite3Register.register();

ConformanceSuite.run({
    createConnection: async () =>
        TdbcOpen.open("tdbc:sqlite:file::memory:", {
            driver: BETTER_SQLITE3_DRIVER_NAME,
            filename: ":memory:",
        }),
    beforeUnknownDriverTest: () => {
        TdbcRegistry.clear();
    },
    afterUnknownDriverTest: () => {
        BetterSqlite3Register.register();
    },
});

describe("better-sqlite3 driver registered", () => {
    /* conformance suite registers nested describes */
});
