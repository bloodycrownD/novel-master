/**
 * Generates Android (legacy + adaptive) and iOS AppIcon PNGs from repo-root icon.webp.
 *
 * Artwork is scaled into the platform "safe zone" so circle / squircle / rounded-square
 * launcher masks do not clip the book & quill. Background color is sampled from corners.
 *
 * Usage: npm run icons -w @novel-master/mobile
 * Source: ../../icon.webp (monorepo root)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(mobileRoot, "../..");
const sourceWebp = path.join(repoRoot, "icon.webp");

/** Fraction of canvas used for artwork (Material adaptive safe zone ≈ 66/108). */
const CONTENT_SCALE = 0.72;

const androidRes = path.join(mobileRoot, "android/app/src/main/res");

/** Legacy launcher + adaptive layer edge length per bucket. */
const ANDROID_DENSITIES = [
  { folder: "mipmap-mdpi", size: 48, adaptive: 108 },
  { folder: "mipmap-hdpi", size: 72, adaptive: 162 },
  { folder: "mipmap-xhdpi", size: 96, adaptive: 216 },
  { folder: "mipmap-xxhdpi", size: 144, adaptive: 324 },
  { folder: "mipmap-xxxhdpi", size: 192, adaptive: 432 },
];

const IOS_ICONS = [
  { name: "Icon-20@2x.png", size: 40 },
  { name: "Icon-20@3x.png", size: 60 },
  { name: "Icon-29@2x.png", size: 58 },
  { name: "Icon-29@3x.png", size: 87 },
  { name: "Icon-40@2x.png", size: 80 },
  { name: "Icon-40@3x.png", size: 120 },
  { name: "Icon-60@2x.png", size: 120 },
  { name: "Icon-60@3x.png", size: 180 },
  { name: "Icon-1024.png", size: 1024 },
];

const iosAppIconSet = path.join(
  mobileRoot,
  "ios/NovelMaster/Images.xcassets/AppIcon.appiconset",
);

function rgbHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Average RGB from image corners (matches icon backdrop). */
async function sampleBackgroundColor(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const points = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of points) {
    const i = (y * width + x) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = points.length;
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  };
}

async function scaledArtwork(input, contentSize) {
  return sharp(input)
    .resize(contentSize, contentSize, {
      fit: "contain",
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
}

/** Flat launcher square: solid bg + centered artwork (legacy + iOS). */
function renderFlatIcon(input, size, bg) {
  const contentSize = Math.max(1, Math.round(size * CONTENT_SCALE));
  const offset = Math.floor((size - contentSize) / 2);
  return scaledArtwork(input, contentSize).then((art) =>
    sharp({
      create: {
        width: size,
        height: size,
        channels: 3,
        background: bg,
      },
    })
      .composite([{ input: art, left: offset, top: offset }])
      .png(),
  );
}

/** Adaptive background layer: solid brand color. */
function renderAdaptiveBackground(size, bg) {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: bg,
    },
  }).png();
}

/** Adaptive foreground layer: artwork on transparent (shows bg through margins). */
function renderAdaptiveForeground(input, size) {
  const contentSize = Math.max(1, Math.round(size * CONTENT_SCALE));
  const offset = Math.floor((size - contentSize) / 2);
  return scaledArtwork(input, contentSize).then((art) =>
    sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: art, left: offset, top: offset }])
      .png(),
  );
}

async function writeFlatIcon(input, outPath, size, bg) {
  const pipeline = await renderFlatIcon(input, size, bg);
  await pipeline.toFile(outPath);
}

async function main() {
  try {
    await fs.access(sourceWebp);
  } catch {
    console.error(`Missing source: ${sourceWebp}`);
    process.exit(1);
  }

  const bg = await sampleBackgroundColor(sourceWebp);
  console.log(`Background ${rgbHex(bg)} · content scale ${CONTENT_SCALE}`);

  for (const { folder, size, adaptive } of ANDROID_DENSITIES) {
    const dir = path.join(androidRes, folder);
    await fs.mkdir(dir, { recursive: true });

    const launcher = path.join(dir, "ic_launcher.png");
    const round = path.join(dir, "ic_launcher_round.png");
    await writeFlatIcon(sourceWebp, launcher, size, bg);
    await writeFlatIcon(sourceWebp, round, size, bg);

    const fg = path.join(dir, "ic_launcher_foreground.png");
    const bgLayer = path.join(dir, "ic_launcher_background.png");
    await (await renderAdaptiveForeground(sourceWebp, adaptive)).toFile(fg);
    await renderAdaptiveBackground(adaptive, bg).toFile(bgLayer);

    console.log(`android ${folder} legacy ${size}px · adaptive ${adaptive}px`);
  }

  const anydpiDir = path.join(androidRes, "mipmap-anydpi-v26");
  await fs.mkdir(anydpiDir, { recursive: true });
  const adaptiveIconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
  await fs.writeFile(path.join(anydpiDir, "ic_launcher.xml"), adaptiveIconXml);
  await fs.writeFile(
    path.join(anydpiDir, "ic_launcher_round.xml"),
    adaptiveIconXml,
  );
  console.log("android mipmap-anydpi-v26 adaptive-icon XML");

  await fs.mkdir(iosAppIconSet, { recursive: true });
  for (const { name, size } of IOS_ICONS) {
    const out = path.join(iosAppIconSet, name);
    await writeFlatIcon(sourceWebp, out, size, bg);
    console.log(`ios ${name} ${size}px`);
  }

  const contentsJson = {
    images: [
      {
        filename: "Icon-20@2x.png",
        idiom: "iphone",
        scale: "2x",
        size: "20x20",
      },
      {
        filename: "Icon-20@3x.png",
        idiom: "iphone",
        scale: "3x",
        size: "20x20",
      },
      {
        filename: "Icon-29@2x.png",
        idiom: "iphone",
        scale: "2x",
        size: "29x29",
      },
      {
        filename: "Icon-29@3x.png",
        idiom: "iphone",
        scale: "3x",
        size: "29x29",
      },
      {
        filename: "Icon-40@2x.png",
        idiom: "iphone",
        scale: "2x",
        size: "40x40",
      },
      {
        filename: "Icon-40@3x.png",
        idiom: "iphone",
        scale: "3x",
        size: "40x40",
      },
      {
        filename: "Icon-60@2x.png",
        idiom: "iphone",
        scale: "2x",
        size: "60x60",
      },
      {
        filename: "Icon-60@3x.png",
        idiom: "iphone",
        scale: "3x",
        size: "60x60",
      },
      {
        filename: "Icon-1024.png",
        idiom: "ios-marketing",
        scale: "1x",
        size: "1024x1024",
      },
    ],
    info: { author: "xcode", version: 1 },
  };
  await fs.writeFile(
    path.join(iosAppIconSet, "Contents.json"),
    `${JSON.stringify(contentsJson, null, 2)}\n`,
  );

  console.log(
    "Done. Uninstall/reinstall the app — launchers cache icons aggressively.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
