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
interface BytesUnit {
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
interface BytesFormat {
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

/** 中文数字字符 → 数值（与 legado `ChnMap` 同口径）。 */
const CHN_NUM_VALUE: Readonly<Record<string, number>> = {
    零: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    〇: 0,
    壹: 1,
    贰: 2,
    叁: 3,
    肆: 4,
    伍: 5,
    陆: 6,
    柒: 7,
    捌: 8,
    玖: 9,
    拾: 10,
    两: 2,
    百: 100,
    佰: 100,
    千: 1000,
    仟: 1000,
    万: 10000,
    亿: 100000000,
};

/** 逐位写法只接受单值数字字符（不含 两/十/百/千/万/亿）。 */
const CHN_POSITIONAL_CHARS = /^[〇零一二三四五六七八九壹贰叁肆伍陆柒捌玖]+$/;

/** 纯 ASCII 整数串（`-?[0-9]+`）。 */
const ASCII_INT = /^-?[0-9]+$/;

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
        let fixed: string;
        if (unit.digits == null) {
            fixed = String(scaled);
        } else if (unit.digits === 0) {
            fixed = String(Math.round(scaled));
        } else {
            fixed = scaled.toFixed(unit.digits);
        }
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

    /**
     * 解析捕获组为数字（legado `stringToInt` 口径）：先剥空白、全角数字折半角；
     * 纯 ASCII 整数串走 `Number()`（`"001"` → 1，保留前导零），否则按中文数字解析
     * （逐位 `"一零二五"` → 1025、带权 `"一千零二十五"` → 1025，含大写与 `"一千二"` → 1200）。
     * 两条路都不适用（空 / 混写 / 未知字符）返回 `null`。
     *
     * @remarks 溢出护栏：约 309 位以上的数字串会让 `Number()` 得到 ±Infinity，
     * 与固定哨兵元组无法区分；非有限结果一律按转换失败（`null`）处理。
     */
    parseChineseNum: (input: string): number | null => {
        // 全角 ASCII 区折半角（legado `fullToHalf`）；U+3000 随后被 `\s+` 一并剥掉。
        let folded = "";
        for (let i = 0; i < input.length; i++) {
            const code = input.charCodeAt(i);
            folded += code >= 0xff01 && code <= 0xff5e ? String.fromCharCode(code - 0xfee0) : input[i];
        }
        const s = folded.replace(/\s+/g, "");
        if (s === "") {
            return null;
        }
        let parsed: number | null;
        if (ASCII_INT.test(s)) {
            parsed = globalThis.Number(s);
        } else if (s.length > 1 && CHN_POSITIONAL_CHARS.test(s)) {
            let digits = "";
            for (const ch of s) {
                digits += String(CHN_NUM_VALUE[ch]);
            }
            parsed = globalThis.Number(digits);
        } else {
            // 带权写法（"一千零二十五" → 1025，含 "一千二" → 1200 与亿级进位）。
            // 任一字符不是可识别中文数字时返回 null（legado 此处返回 -1）。
            let result = 0;
            let tmp = 0;
            let billion = 0;
            const chars = Array.from(s);
            for (let i = 0; i < chars.length; i++) {
                const value = CHN_NUM_VALUE[chars[i]!];
                if (value === undefined) {
                    return null;
                }
                if (value === 100000000) {
                    result += tmp;
                    result *= value;
                    billion = billion * 100000000 + result;
                    result = 0;
                    tmp = 0;
                } else if (value === 10000) {
                    result += tmp;
                    result *= value;
                    tmp = 0;
                } else if (value >= 10) {
                    if (tmp === 0) {
                        tmp = 1;
                    }
                    result += value * tmp;
                    tmp = 0;
                } else {
                    // 单位后紧跟个位数是缩写形式："一千二" → 2 * 1000 / 10 = 200
                    //（legado 规则：i >= 2、末字符、前一字符单位 > 10）。
                    const prevUnit = i >= 2 && i === chars.length - 1 ? CHN_NUM_VALUE[chars[i - 1]!] : undefined;
                    tmp = prevUnit !== undefined && prevUnit > 10 ? (value * prevUnit) / 10 : tmp * 10 + value;
                }
            }
            parsed = result + tmp + billion;
        }
        return parsed !== null && globalThis.Number.isFinite(parsed) ? parsed : null;
    },

    /**
     * 整数收敛：缺省 / 非有限数 / 小于 `min` → `fallback`；其余向下取整并 clamp 到 `max`。
     * 三个边界都是调用侧业务口径，本工具不内置任何默认值。
     */
    clampIntOrDefault: (value: number | undefined, options: {readonly fallback: number; readonly min: number; readonly max: number}): number => {
        if (value == null || !globalThis.Number.isFinite(value) || value < options.min) {
            return options.fallback;
        }
        return Math.min(Math.floor(value), options.max);
    },

    /** 有序列表「首 head 条 + 尾 tail 条」的下标集合（两条区间重叠时取并集）。 */
    headTailIndices: (totalCount: number, head: number, tail: number): Set<number> => {
        const indices = new Set<number>();
        for (let i = 0; i < head && i < totalCount; i++) {
            indices.add(i);
        }
        for (let i = 0; i < tail && i < totalCount; i++) {
            indices.add(totalCount - 1 - i);
        }
        return indices;
    },
} as const;
