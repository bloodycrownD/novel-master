/**
 * composer-input WebView 打包入口（esbuild → IIFE app.js）。
 *
 * 装配顺序：先建 DOM 与事件（后续 init 直接应用），再挂 host 消息通道，
 * 最后发 ready——宿主一切下行以 ready 为门控。
 */
import {bindHostMessageChannel} from '@web/shared/host-message-channel';
import {handleHostMessage, post} from './runtime/bridge';
import {mountComposerEditor} from './runtime/editor';
import {BRIDGE_V} from './runtime/model';

const root = document.getElementById('root');
if (root != null) {
  mountComposerEditor(root);
}

bindHostMessageChannel(handleHostMessage);

post('ready', {version: BRIDGE_V});
