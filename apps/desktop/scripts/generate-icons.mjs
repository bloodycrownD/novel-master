/**
 * Generates Electron app icons from assets/icon.webp.
 * Outputs: build/icons/icon.png (256), icon-512.png, icon.ico; icon.icns on macOS.
 *
 * Usage: npm run build:icons -w @novel-master/desktop
 */
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const sourceWebp = path.join(repoRoot, "assets/icon.webp");
const outDir = path.join(desktopRoot, "build/icons");

async function writePng(size, filename) {
  const outPath = path.join(outDir, filename);
  await sharp(sourceWebp)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  return outPath;
}

async function writeIco() {
  const sizes = [16, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(
    sizes.map((size) =>
      sharp(sourceWebp)
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
    ),
  );
  const ico = await pngToIco(buffers);
  await fs.writeFile(path.join(outDir, "icon.ico"), ico);
}

async function writeIcnsMac() {
  if (process.platform !== "darwin") {
    return;
  }
  const iconsetDir = path.join(outDir, "icon.iconset");
  await fs.rm(iconsetDir, { recursive: true, force: true });
  await fs.mkdir(iconsetDir, { recursive: true });
  const spec = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
  ];
  for (const [size, name] of spec) {
    await sharp(sourceWebp)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(iconsetDir, name));
  }
  execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(outDir, "icon.icns")}"`);
  await fs.rm(iconsetDir, { recursive: true, force: true });
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await writePng(256, "icon.png");
  await writePng(512, "icon-512.png");
  await writeIco();
  await writeIcnsMac();
  console.log(`[desktop] icons written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
