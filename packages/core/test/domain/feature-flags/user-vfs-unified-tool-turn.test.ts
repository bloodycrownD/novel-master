import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  DEFAULT_USER_VFS_UNIFIED_TOOL_TURN,
  userVfsUnifiedToolTurnFlag,
} from "../../../src/domain/feature-flags/user-vfs-unified-tool-turn.js";

describe("user-vfs-unified-tool-turn", () => {
  const envKey = "NM_USER_VFS_UNIFIED_TOOL_TURN";
  let prevEnv: string | undefined;

  afterEach(() => {
    userVfsUnifiedToolTurnFlag.resetForTests();
    if (prevEnv === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = prevEnv;
    }
  });

  it("默认与显式 configured", () => {
    userVfsUnifiedToolTurnFlag.resetForTests();
    assert.equal(DEFAULT_USER_VFS_UNIFIED_TOOL_TURN, true);
    assert.equal(userVfsUnifiedToolTurnFlag.isEnabled(), true);
    assert.equal(userVfsUnifiedToolTurnFlag.isEnabled(true), true);
    assert.equal(userVfsUnifiedToolTurnFlag.isEnabled(false), false);
  });

  it("env=0 强制关闭", () => {
    prevEnv = process.env[envKey];
    userVfsUnifiedToolTurnFlag.refresh(true);
    process.env[envKey] = "0";
    assert.equal(userVfsUnifiedToolTurnFlag.isEnabled(), false);
  });

  it("preference 快照为 false", () => {
    prevEnv = process.env[envKey];
    userVfsUnifiedToolTurnFlag.refresh(false);
    assert.equal(userVfsUnifiedToolTurnFlag.isEnabled(), false);
  });

  it("快照未设时回退默认 true", () => {
    prevEnv = process.env[envKey];
    userVfsUnifiedToolTurnFlag.resetForTests();
    assert.equal(userVfsUnifiedToolTurnFlag.isEnabled(), true);
  });
});
