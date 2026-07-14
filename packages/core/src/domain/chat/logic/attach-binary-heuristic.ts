/**
 * `@` / hydrate 文本 vs 二进制扩展名启发式（P2；误判可接受）。
 *
 * @module domain/chat/logic/attach-binary-heuristic
 */

/** 常见二进制 / 图片扩展名（小写、无点）。 */
const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "heic",
  "avif",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "7z",
  "rar",
  "tar",
  "xz",
  "bz2",
  "mp3",
  "mp4",
  "m4a",
  "wav",
  "ogg",
  "webm",
  "mov",
  "avi",
  "mkv",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "dat",
  "wasm",
  "class",
  "o",
  "obj",
  "sqlite",
  "db",
  "psd",
  "ai",
  "sketch",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "heic",
  "avif",
]);

function extensionOf(path: string): string {
  const base = path.includes("/")
    ? path.slice(path.lastIndexOf("/") + 1)
    : path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

/** path 是否按扩展名视为二进制。 */
export function isBinaryAttachPath(path: string): boolean {
  const ext = extensionOf(path);
  return ext !== "" && BINARY_EXTENSIONS.has(ext);
}

/** path 是否按扩展名视为图片。 */
export function isImageAttachPath(path: string): boolean {
  const ext = extensionOf(path);
  return ext !== "" && IMAGE_EXTENSIONS.has(ext);
}
