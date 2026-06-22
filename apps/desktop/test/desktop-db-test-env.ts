import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setMacKeychainTestPassthrough } from "@novel-master/sksp-mac";
import { setDpapiTestPassthrough } from "@novel-master/sksp-windows";
import { resetDesktopRuntimeForTest } from "../src/main/runtime/desktop-runtime-singleton.js";

export async function setupDesktopDbTestEnv(
  prefix: string,
): Promise<{ tempDir: string }> {
  if (process.platform === "darwin") {
    setMacKeychainTestPassthrough(true);
  } else {
    setDpapiTestPassthrough(true);
  }
  await resetDesktopRuntimeForTest();
  const tempDir = await mkdtemp(join(tmpdir(), prefix));
  process.env.NOVEL_MASTER_DB = join(tempDir, "novel.db");
  return { tempDir };
}

export async function teardownDesktopDbTestEnv(tempDir: string): Promise<void> {
  await resetDesktopRuntimeForTest();
  delete process.env.NOVEL_MASTER_DB;
  if (process.platform === "darwin") {
    setMacKeychainTestPassthrough(false);
  } else {
    setDpapiTestPassthrough(false);
  }
  await rm(tempDir, { recursive: true, force: true });
}
