/**
 * 数组纯原语。只做数组变换，不认识任何业务实体；域内的收集策略留在各域。
 *
 * @module common/arrays
 */

export const Arrays = {
    /** 去重追加：值非 null/空串且不在列表内才 push（累加器形态，push-only 无重绑定）。 */
    pushIfAbsent: (list: string[], value: string | undefined): void => {
        if (value != null && value.length > 0 && !list.includes(value)) list.push(value);
    },
} as const;
