import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_USER_VFS_UNIFIED_TOOL_TURN,
  isUserVfsUnifiedToolTurnEnabled,
  refreshUserVfsUnifiedToolTurnSnapshot,
  resetUserVfsUnifiedToolTurnSnapshotForTests,
} from "../../../src/domain/feature-flags/user-vfs-unified-tool-turn.js";

describe("user-vfs-unified-tool-turn", () => {
  const envKey = "NM_USER_VFS_UNIFIED_TOOL_TURN";
  let prevEnv: string | undefined;

  afterEach(() => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    if (prevEnv === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = prevEnv;
    }
  });

  it("默认与显式 configured", () => {
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    assert.equal(DEFAULT_USER_VFS_UNIFIED_TOOL_TURN, true);
    assert.equal(isUserVfsUnifiedToolTurnEnabled(), true);
    assert.equal(isUserVfsUnifiedToolTurnEnabled(true), true);
    assert.equal(isUserVfsUnifiedToolTurnEnabled(false), false);
  });

  it("env=0 强制关闭", () => {
    prevEnv = process.env[envKey];
    refreshUserVfsUnifiedToolTurnSnapshot(true);
    process.env[envKey] = "0";
    assert.equal(isUserVfsUnifiedToolTurnEnabled(), false);
  });

  it("preference 快照为 false", () => {
    prevEnv = process.env[envKey];
    refreshUserVfsUnifiedToolTurnSnapshot(false);
    assert.equal(isUserVfsUnifiedToolTurnEnabled(), false);
  });

  it("快照未设时回退默认 true", () => {
    prevEnv = process.env[envKey];
    resetUserVfsUnifiedToolTurnSnapshotForTests();
    assert.equal(isUserVfsUnifiedToolTurnEnabled(), true);
  });
});
