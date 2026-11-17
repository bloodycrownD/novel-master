/**
 * 数值格式化纯工具。
 *
 * 对象名按约定叫 `Number`；模块内访问原生数字工具一律走 `globalThis.Number`，
 * 避免被本文件的局部绑定遮蔽。
 *
 * @module common/number
 */

/**
 * 字节格式化的一档单位：`scale` 是 1024 进位基数，`digits` 是保留小数位
 * （**缺省表示不截断**、按 `String` 原样输出），`trim` 为 true 时裁掉尾部的零
 * （`"2.0"` → `"2"`）。
 */
export interface BytesUnit {
    readonly suffix: string;
    readonly scale: number;
    readonly digits?: number;
    readonly trim?: boolean;
}

/**
 * 字节格式化配方：`units` 由小到大排列，`separator` 是数值与后缀之间的分隔
 * （缺省空串）。
 *
 * 判据（签名审计十五期）：两份字节格式化的差异全部落在这四个声明式维度上
 * （单位梯度 / 分隔符 / 每单位精度 / 是否去尾零），所以参数化而不是留两份；
 * 「输出不同」本身不构成不收敛的理由。
 */
export interface BytesFormat {
    readonly units: readonly BytesUnit[];
    readonly separator?: string;
}

/** 紧凑档（工具输出体积）：B/KB/MB、无空格、1 位小数去尾零（B 档原样输出）。 */
const COMPACT_BYTES: BytesFormat = {
    units: [
        { suffix: "B", scale: 1 },
        { suffix: "KB", scale: 1024, digits: 1, trim: true },
        { suffix: "MB", scale: 1024 ** 2, digits: 1, trim: true },
    ],
};

/** 存储档（设置页库体积）：KB/MB/GB、单位前带空格、精度按档递减（0 / 1 / 2 位）。 */
// nm-style: keep-public — mobile StorageConfigScreen 直接消费本配置（`null → "—"` 留在调用侧）。
export const STORAGE_BYTES: BytesFormat = {
    units: [
        { suffix: "KB", scale: 1024, digits: 0 },
        { suffix: "MB", scale: 1024 ** 2, digits: 1 },
        { suffix: "GB", scale: 1024 ** 3, digits: 2 },
    ],
    separator: " ",
};

export const Number = {
    /** 非负整数补零到两位（`7` → `"07"`）；超过两位原样返回，不截断。 */
    pad2: (value: number): string => String(value).padStart(2, "0"),

    /**
     * 紧凑 locale 整数格式化（`2500` → `"2,500"`）：编辑器字数统计、指标条 token 数等共用单点。
     * 走运行时 `Intl`/`toLocaleString`，三端各自按 `zh-CN` 输出。
     */
    charCount: (n: number): string => n.toLocaleString("zh-CN"),

    /**
     * 字节数格式化：由大到小取第一个 `bytes >= scale` 的单位（不够最小档 / 负数落最小档），
     * 按该档 `digits` 保留小数、`trim` 裁尾零，数值与后缀之间按 `separator` 拼接。
     *
     * 缺省档 {@link COMPACT_BYTES}：1024 进位（B/KB/MB）、1 位小数（整数位不带 .0）、
     * B 档按原值输出；负数按字节带符号输出（`-2048` → `"-2048B"`）；极大值继续用 MB 表达。
     * `NaN` / `±Infinity` 原样 `String()` 化。
     */
    formatBytes: (bytes: number, format: BytesFormat = COMPACT_BYTES): string => {
        if (!globalThis.Number.isFinite(bytes)) {
            return String(bytes);
        }
        const units = format.units;
        let unit = units[0]!;
        for (let index = units.length - 1; index > 0; index -= 1) {
            if (bytes >= units[index]!.scale) {
                unit = units[index]!;
                break;
            }
        }
        const scaled = bytes / unit.scale;
        const fixed = unit.digits == null ? String(scaled) : unit.digits === 0 ? String(Math.round(scaled)) : scaled.toFixed(unit.digits);
        const value = unit.trim === true ? fixed.replace(/\.0+$/, "") : fixed;
        return `${value}${format.separator ?? ""}${unit.suffix}`;
    },

    /**
     * 保留 1 位小数并裁掉尾部的 `.0`（`2` → `"2"`，`1.25` → `"1.3"`）。
     * `NaN` / `Infinity` 与 `toFixed` 口径一致，原样字符串化。
     */
    trimFraction: (n: number): string => {
        const fixed = n.toFixed(1);
        return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
    },
} as const;
