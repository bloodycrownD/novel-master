/**
 * 模块级 toast 桥：供非组件层（service 等）弹提示。
 * ToastHost 挂载时注册实现，未挂载时静默丢弃，避免崩溃。
 * 本文件必须保持零 react-native 依赖，否则会被 service 层测试拖入 RN 内部模块。
 */
type AppToastSink = (message: string) => void;

/** toast 实现槽（模块内 holder，对象管理；null = ToastHost 未挂载，静默丢弃）。 */
const toastSlot = {
  sink: null as AppToastSink | null,
};

export namespace AppToast {
  export function registerSink(next: AppToastSink | null): void {
    toastSlot.sink = next;
  }

  export function show(message: string): void {
    toastSlot.sink?.(message);
  }
}
