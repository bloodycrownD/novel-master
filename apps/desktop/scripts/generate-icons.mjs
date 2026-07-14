/**
 * Generates Electron app icons from assets/icon.webp.
 * Outputs: build/icons/icon.png (256), icon-512.png, icon.ico;
 *          icon-mac.png (512 preview); icon.icns on macOS.
 *
 * macOS (Big Sur+): icons are NOT full-bleed. Apple's grid uses an
 * 824×824 plate centered on a 1024×1024 canvas (~100px transparent
 * gutter). Bake rounded corners + transparency; Dock does not shrink
 * a full-bleed square for you — that makes the icon look larger than
 * neighbouring apps.
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

/** Apple macOS app-icon grid: 824/1024 content plate. */
const MAC_PLATE_RATIO = 824 / 1024;
/** Continuous-corner radius on the 824 plate (Apple template ≈ 185.4). */
const MAC_CORNER_RATIO = 185.4 / 824;

/**
 * Rounded plate on transparent canvas (macOS Dock / Finder size parity).
 * Reference (1024): 100px gutter, rx≈185.4, shadow 28/12 @ 50% black.
 */
async function renderMacIconPng(input, size) {
  const plateSize = Math.max(1, Math.round(size * MAC_PLATE_RATIO));
  const offset = Math.floor((size - plateSize) / 2);
  const radius = Math.max(1, Math.round(plateSize * MAC_CORNER_RATIO));

  const plate = await sharp(input)
    .resize(plateSize, plateSize, {
      fit: "cover",
      kernel: sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  const roundMask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${plateSize}" height="${plateSize}">
      <rect width="${plateSize}" height="${plateSize}" rx="${radius}" ry="${radius}" fill="#fff"/>
    </svg>`,
  );

  const roundedPlate = await sharp(plate)
    .composite([{ input: roundMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const layers = [];
  if (size >= 64) {
    const scale = size / 1024;
    const blurSigma = Math.max(0.5, 14 * scale);
    const shadowY = Math.round(12 * scale);
    const { data, info } = await sharp(roundedPlate)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.round(data[i + 3] * 0.5);
    }
    const shadow = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .blur(blurSigma)
      .png()
      .toBuffer();
    layers.push({
      input: shadow,
      left: offset,
      top: Math.min(size - plateSize, offset + shadowY),
    });
  }
  layers.push({ input: roundedPlate, left: offset, top: offset });

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(layers)
    .png();
}

async function writePng(size, filename) {
  const outPath = path.join(outDir, filename);
  await sharp(sourceWebp)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outPath);
  return outPath;
}

async function writeIco() {
  const sizes = [16, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(
    sizes.map((size) =>
      sharp(sourceWebp)
        .resize(size, size, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer(),
    ),
  );
  const ico = await pngToIco(buffers);
  await fs.writeFile(path.join(outDir, "icon.ico"), ico);
}

async function writeMacPreviewPng() {
  const pipeline = await renderMacIconPng(sourceWebp, 512);
  await pipeline.toFile(path.join(outDir, "icon-mac.png"));
}

async function writeIcnsMac() {
  if (process.platform !== "darwin") {
    console.log("[desktop] skip icon.icns (iconutil requires macOS)");
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
    const pipeline = await renderMacIconPng(sourceWebp, size);
    await pipeline.toFile(path.join(iconsetDir, name));
  }
  execSync(
    `iconutil -c icns "${iconsetDir}" -o "${path.join(outDir, "icon.icns")}"`,
  );
  await fs.rm(iconsetDir, { recursive: true, force: true });
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await writePng(256, "icon.png");
  await writePng(512, "icon-512.png");
  await writeIco();
  await writeMacPreviewPng();
  await writeIcnsMac();
  console.log(`[desktop] icons written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
