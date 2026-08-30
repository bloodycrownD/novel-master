/**
 * rich-document → RN postMessage 出口（无业务依赖，避免 bridge↔annotate 环）。
 * 统一绑定 @web/shared/post 工厂（web/C-orch-1）：仅绑定本 webview 的 BRIDGE_V。
 */
import {BRIDGE_V} from './document-model';
import {createBoundPost} from '@web/shared/post';

export const post = createBoundPost(BRIDGE_V);
