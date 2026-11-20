/**
 * 模块级 toast 桥：供非组件层（service 等）弹提示。
 * ToastHost 挂载时注册实现，未挂载时静默丢弃，避免崩溃。
 * 本文件必须保持零 react-native 依赖，否则会被 service 层测试拖入 RN 内部模块。
 */
type AppToastSink = (message: string) => void;

let sink: AppToastSink | null = null;

export namespace AppToast {
  export function registerSink(next: AppToastSink | null): void {
    sink = next;
  }

  export function show(message: string): void {
    sink?.(message);
  }
}
