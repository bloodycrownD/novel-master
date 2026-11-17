/**
 * 通用判断工具（type guards / predicates）。
 *
 * 只放「输入 unknown、输出类型收窄或布尔」的小函数；序列化、格式化等
 * 其他类别各开同层模块（如 `json.ts`、`encoding.ts`），不往这里堆。
 *
 * @module common/guards
 */

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "heic", "avif"]);

/** 常见二进制扩展名（小写、无点）；图片扩展名是它的子集（IMAGE ⊆ BINARY）。 */
const BINARY_EXTENSIONS = new Set([
    ...IMAGE_EXTENSIONS,
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

function extensionOf(path: string): string {
    const base = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) {
        return "";
    }
    return base.slice(dot + 1).toLowerCase();
}

export const Guards = {
    /** 判断值是不是非数组的普通对象（JSON object）。只排除 `null` 与数组，不校验原型。 */
    isRecord: (value: unknown): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value),

    /**
     * 非空字符串判定：只判 UTF-16 长度 > 0（空白串算非空）。
     * 「trim 后非空」的取值口径走 `Coerce.nonEmptyText`。
     */
    isNonEmptyString: (value: unknown): value is string => typeof value === "string" && value.length > 0,

    /** path 是否按扩展名视为二进制。 */
    isBinaryFilePath: (path: string): boolean => {
        const ext = extensionOf(path);
        return ext !== "" && BINARY_EXTENSIONS.has(ext);
    },

    /** path 是否按扩展名视为图片。 */
    isImageFilePath: (path: string): boolean => {
        const ext = extensionOf(path);
        return ext !== "" && IMAGE_EXTENSIONS.has(ext);
    },
} as const;
