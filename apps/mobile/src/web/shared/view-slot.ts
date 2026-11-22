/**
 * register/invoke 视图槽：main 装配点注册视图刷新实现，runtime 门面只转发。
 *
 * P0-3 范式（三管线共用）：ui 层（Preact）不许被 runtime 直接 import——runtime
 * 只持有一个实现引用，`main.ts` / `*factory.ts` 在装配时注册。引用此前在三处
 * 各写一份 `let xxx: ((p: P) => void) | null` + 两个自由函数，本文件是那份
 * 「未注册则 invoke 返回 false」不变量的唯一实现。
 *
 * `invoke` 的布尔回值不是装饰：调用方（菜单打开 / setDocument / renderRows）
 * 用它决定后续副作用（挂 overlay 监听、置 menu-open 类）要不要发生。
 *
 * `has` 供需要「注册缺失就走另一条路径」的调用方使用（mermaid 全屏在开门前
 * 成对校验渲染器与 post；缺渲染器时不能先把状态置成打开态）。
 *
 * 位置在 `web/shared/`：四个 webview 包（chat-transcript / rich-document /
 * code-editor / composer-input）的 esbuild 入口都按 `@web/*` → `src/web/*`
 * 解析（见 scripts/build-webview.mjs 的 webAlias），本文件零依赖，不碰
 * `packages/core/dist`，不进依赖准入白名单。
 *
 * @module shared/view-slot
 */

/** 视图槽的注册/调用面；未注册时 `invoke` 返回 false 且不产生任何副作用。 */
export interface ViewSlot<P> {
    /** 是否已注册实现（需要「缺失即走另一条路径」时用）。 */
    has(): boolean;
    /** 由装配点注册视图刷新/卸载实现（覆盖上一次注册）。 */
    register(render: (props: P) => void): void;
    /** 调用已注册实现；未注册返回 false。 */
    invoke(props: P): boolean;
}

export const ViewSlot = {
    create: <P>(): ViewSlot<P> => {
        let render: ((props: P) => void) | null = null;
        return {
            has: () => render != null,
            register(next) {
                render = next;
            },
            invoke(props) {
                if (render == null) return false;
                render(props);
                return true;
            },
        };
    },
} as const;
