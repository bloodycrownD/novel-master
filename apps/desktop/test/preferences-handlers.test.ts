import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  handlePreferencesGetSubagentStream,
  handlePreferencesSetSubagentStream,
} from "../src/main/ipc/handlers/preferences.js";
import { getDesktopRuntime } from "../src/main/runtime/desktop-runtime-singleton.js";
import {
  setupDesktopDbTestEnv,
  teardownDesktopDbTestEnv,
} from "./desktop-db-test-env.js";

// subagent-stream-toggle Step 4（T-D1）：直调 IPC handler，验证
// chat.subagentStream 偏好经 desktop runtime 的 get/set/reset 全链可用。
describe("preferences IPC handlers — subagentStream（T-D1）", () => {
  let tempDir: string;

  before(async () => {
    ({ tempDir } = await setupDesktopDbTestEnv("nm-prefs-subagent-"));
  });

  after(async () => {
    await teardownDesktopDbTestEnv(tempDir);
  });

  it("get 默认 true（未 set 过键）", async () => {
    const got = await handlePreferencesGetSubagentStream();
    assert.equal(got.ok, true);
    if (!got.ok) {
      return;
    }
    assert.equal(got.data, true);
  });

  it("set false 后回读 false", async () => {
    const set = await handlePreferencesSetSubagentStream(false);
    assert.equal(set.ok, true);
    if (!set.ok) {
      return;
    }
    assert.equal(set.data, undefined);

    const got = await handlePreferencesGetSubagentStream();
    assert.equal(got.ok, true);
    if (!got.ok) {
      return;
    }
    assert.equal(got.data, false);
  });

  it("reset 后恢复默认 true（依赖上一用例已 set false）", async () => {
    // 直接经共享 runtime 调 core 的 reset（IPC 五件套不含 reset 通道）。
    const rt = await getDesktopRuntime();
    await rt.preferences.resetSubagentStreamEnabled();

    const got = await handlePreferencesGetSubagentStream();
    assert.equal(got.ok, true);
    if (!got.ok) {
      return;
    }
    assert.equal(got.data, true);
  });
});
