import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { checkForUpdates } from "../../src/main/update-check/check-for-updates.js";

// NOVEL_MASTER_DISABLE_UPDATE_CHECK 短路（e2e 专用 hook）：置位时应在编排入口
// 直接抛错，不触达任何网络 fetch（否则 e2e 环境每轮启动多付一次 GitHub fetch 超时）
const ENV_KEY = "NOVEL_MASTER_DISABLE_UPDATE_CHECK";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("checkForUpdates env 短路", () => {
  it("NOVEL_MASTER_DISABLE_UPDATE_CHECK=1 时立即抛错且不发起 fetch", async () => {
    process.env[ENV_KEY] = "1";
    let fetchCalled = false;
    const guardFetch = async () => {
      fetchCalled = true;
      throw new Error("短路路径不应触达 fetch");
    };
    await assert.rejects(
      checkForUpdates("2.0.0", guardFetch),
      /更新检查已禁用/,
    );
    assert.equal(fetchCalled, false, "短路后不得发起任何网络请求");
  });

  it("env 未置位时走正常比较链路", async () => {
    delete process.env[ENV_KEY];
    const mockFetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: "v2.1.0",
          html_url: "https://github.com/bloodycrownD/novel-master/releases/tag/v2.1.0",
          body: "Release notes",
        }),
      }) as Response;
    const data = await checkForUpdates("2.0.0", mockFetch);
    assert.equal(data.status, "update-available");
    assert.equal(data.remoteVersion, "2.1.0");
  });
});
