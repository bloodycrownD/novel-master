/**
 * code-editor → RN postMessage 出口。
 * 函数体统一在 @web/shared/post；此处仅绑定本 webview 的 BRIDGE_V。
 */
import { BRIDGE_V } from './model';
import { post as sharedPost } from '@web/shared/post';

export function post(type: string, payload?: Record<string, unknown>): void {
  sharedPost(type, payload, BRIDGE_V);
}
