/**
 * 本地时间格式化纯工具。
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
} as const;
