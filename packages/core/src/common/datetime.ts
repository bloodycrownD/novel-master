/**
 * 本地时间格式化与本地日历日算术纯工具。
 *
 * @module common/datetime
 */

import {Number} from "./number.js";

export const DateTime = {
    /** 本地时区 `yyyy-MM-dd HH:mm:ss`；`number` 按 epoch ms 解释（`Date` 原样取字段）。 */
    localDateTime: (value: Date | number): string => {
        const d = value instanceof Date ? value : new Date(value);
        return `${d.getFullYear()}-${Number.pad2(d.getMonth() + 1)}-${Number.pad2(d.getDate())} ${Number.pad2(d.getHours())}:${Number.pad2(d.getMinutes())}:${Number.pad2(d.getSeconds())}`;
    },

    /**
     * 本地日历日键 `YYYY-MM-DD`（年份 4 位补零，与 SQLite `strftime('%Y-%m-%d', …, 'localtime')` 同构）。
     * `number` 按 epoch ms 解释。
     */
    localDayKey: (value: Date | number): string => {
        const d = value instanceof Date ? value : new Date(value);
        return `${String(d.getFullYear()).padStart(4, "0")}-${Number.pad2(d.getMonth() + 1)}-${Number.pad2(d.getDate())}`;
    },

    /** 以本地日历日为基点加天数（`days` 可为负；`Date` 构造器对 DST 安全，不用固定毫秒加法）。 */
    addLocalDays: (base: Date, days: number): Date => new Date(base.getFullYear(), base.getMonth(), base.getDate() + days),

    /** 本地当天 0 点（即 `addLocalDays(base, 0)`）。 */
    startOfDay: (date: Date): Date => DateTime.addLocalDays(date, 0),

    /** 两个时刻是否落在同一本地日历日。 */
    isSameDay: (a: Date, b: Date): boolean => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(),

    /**
     * 本地中文星期标签（如「星期一」；原 prompt-template/week-cn 上收）。
     * nm-style: keep-local —— 单点生产调用（$.week_cn 宏展开）但它是日期
     * 格式化家族成员，内联回 expand-dynamic-macros 会退回 domain，与上收方向相反。
     */
    weekCn: (date: Date): string => date.toLocaleDateString("zh-CN", { weekday: "long" }),
} as const;
