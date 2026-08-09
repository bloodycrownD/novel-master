/**
 * rich-document → RN postMessage 出口（无业务依赖，避免 bridge↔annotate 环）。
 * 函数体统一在 @web/shared/post；此处仅绑定本 webview 的 BRIDGE_V。
 */
import { BRIDGE_V } from './document-model';
import { post as sharedPost } from '@web/shared/post';

export function post(type: string, payload?: Record<string, unknown>): void {
  sharedPost(type, payload, BRIDGE_V);
}
