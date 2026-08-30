/**
 * code-editor → RN postMessage 出口。
 * 统一绑定 @web/shared/post 工厂（web/C-orch-1）：仅绑定本 webview 的 BRIDGE_V。
 */
import { BRIDGE_V } from './model';
import { createBoundPost } from '@web/shared/post';

export const post = createBoundPost(BRIDGE_V);
