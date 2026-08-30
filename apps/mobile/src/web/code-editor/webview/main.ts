/**
 * code-editor WebView 打包入口（esbuild → IIFE app.js）。
 */
import { handleHostMessage } from './runtime/bridge';
import { post } from './runtime/post';
import { bindHostMessageChannel } from '@web/shared/host-message-channel';

bindHostMessageChannel(handleHostMessage);

post('ready', { version: 1 });
