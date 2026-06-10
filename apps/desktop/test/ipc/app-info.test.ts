import assert from "node:assert/strict";
import { after, describe, it, mock } from "node:test";
import {
  __setAppInfoSeamsForTests,
  handleAppCheckForUpdates,
  handleAppGetInfo,
  handleAppOpenExternal,
} from "../../src/main/ipc/handlers/app-info.js";

const sampleUpdateData = {
  localVersion: "1.2.3",
  remoteVersion: "2.0.0",
  tagName: "v2.0.0",
  releaseUrl:
    "https://github.com/bloodycrownD/novel-master/releases/tag/v2.0.0",
  releaseNotesExcerpt: "Release notes",
  status: "update-available" as const,
};

const mockOpenExternal = mock.fn(async () => {});

after(() => {
  __setAppInfoSeamsForTests(null);
});

describe("app-info ipc handlers", () => {
  it("handleAppGetInfo returns version, platform, and name", async () => {
    __setAppInfoSeamsForTests({
      getVersion: () => "1.2.3",
      getName: () => "Novel Master",
      getPlatform: () => "win32",
    });

    const result = await handleAppGetInfo();
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.data.version, "1.2.3");
    assert.equal(result.data.platform, "win32");
    assert.equal(result.data.name, "Novel Master");
  });

  it("handleAppCheckForUpdates returns update-check DTO on success", async () => {
    __setAppInfoSeamsForTests({
      runUpdateCheck: async () => sampleUpdateData,
    });

    const result = await handleAppCheckForUpdates();
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.data.localVersion, "1.2.3");
    assert.equal(result.data.remoteVersion, "2.0.0");
    assert.equal(result.data.tagName, "v2.0.0");
    assert.match(result.data.releaseUrl, /releases\/tag\/v2.0.0/);
    assert.equal(result.data.releaseNotesExcerpt, "Release notes");
    assert.equal(result.data.status, "update-available");
  });

  it("handleAppCheckForUpdates maps service errors to ipc error payload", async () => {
    __setAppInfoSeamsForTests({
      runUpdateCheck: async () => {
        throw new Error("Network unavailable");
      },
    });

    const result = await handleAppCheckForUpdates();
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.code, "Error");
    assert.equal(result.error.message, "Network unavailable");
  });

  it("handleAppOpenExternal rejects invalid URLs", async () => {
    const result = await handleAppOpenExternal({ url: "not-a-url" });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.error.code, "INVALID_URL");
    assert.equal(result.error.message, "无效的链接");
  });

  it("handleAppOpenExternal opens valid https URLs", async () => {
    mockOpenExternal.mock.resetCalls();
    __setAppInfoSeamsForTests({
      openExternal: mockOpenExternal,
    });

    const url = "https://github.com/bloodycrownD/novel-master/releases";
    const result = await handleAppOpenExternal({ url });
    assert.equal(result.ok, true);
    assert.equal(mockOpenExternal.mock.callCount(), 1);
    assert.equal(mockOpenExternal.mock.calls[0]?.arguments[0], url);
  });
});
