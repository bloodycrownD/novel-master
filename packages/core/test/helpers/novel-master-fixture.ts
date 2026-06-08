import { after, before } from "node:test";
import {
  openNovelMasterTestConnection,
  type NovelMasterTestContext,
} from "./novel-master.js";

let sharedCtx: NovelMasterTestContext | undefined;

/** Registers before/after hooks for one shared in-memory DB per test file. */
export function novelMasterTestFixture(): void {
  before(async () => {
    sharedCtx = await openNovelMasterTestConnection();
  });
  after(async () => {
    await sharedCtx!.conn.close();
    sharedCtx = undefined;
  });
}

export function getNovelMasterTestContext(): NovelMasterTestContext {
  if (sharedCtx == null) {
    throw new Error("Call novelMasterTestFixture() in this file first");
  }
  return sharedCtx;
}

/** Unique suffix for project/session names inside a shared DB. */
export function testIsolationSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
