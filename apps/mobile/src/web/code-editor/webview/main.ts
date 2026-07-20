/**
 * code-editor WebView 打包入口（esbuild → IIFE app.js）。
 */
import { handleHostMessage } from './runtime/bridge';
import { post } from './runtime/post';

document.addEventListener('message', function (e: Event) {
  const ev = e as MessageEvent;
  handleHostMessage(ev.data);
});
window.addEventListener('message', function (e: MessageEvent) {
  handleHostMessage(e.data);
});

post('ready', { version: 1 });
