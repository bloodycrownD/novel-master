/**
 * code-editor WebView 打包入口（esbuild → IIFE app.js）。
 */
import {CodeEditorBridge} from './runtime/bridge';
import {post} from './runtime/post';
import {HostMessageChannel} from '@web/shared/host-message-channel';

HostMessageChannel.bind(CodeEditorBridge.handle);

post('ready', {version: 1});
