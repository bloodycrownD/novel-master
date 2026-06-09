import assert from "node:assert/strict";
import test from "node:test";

import afterPack from "../scripts/after-pack.mjs";

test("afterPack skips non-macOS targets", async () => {
  await afterPack({
    electronPlatformName: "win32",
    appOutDir: "/tmp/unused",
    packager: {
      appInfo: { productFilename: "Novel Master" },
    },
  });
  assert.ok(true, "win32 should no-op without throwing");
});
