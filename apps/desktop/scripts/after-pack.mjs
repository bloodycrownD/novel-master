/**
 * electron-builder afterPack hook.
 *
 * macOS: ad-hoc codesign so Gatekeeper shows "unknown developer" instead of
 * "app is damaged" for unsigned downloads (CSC_IDENTITY_AUTO_DISCOVERY=false).
 * Does not notarize — users can still right-click → Open on first launch.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * @param {import("electron-builder").AfterPackContext} context
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  const result = spawnSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", appPath],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(
      `ad-hoc codesign failed for ${appPath} (exit ${result.status ?? "unknown"})`,
    );
  }
}
