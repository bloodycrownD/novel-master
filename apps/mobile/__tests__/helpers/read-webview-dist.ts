/**
 * 从 webview-dist 产物读取契约测所需文本（pretest 已 build:webview）。
 */
import fs from 'node:fs';
import path from 'node:path';

const distRoot = path.join(__dirname, '../../webview-dist');

export function readWebViewDistFile(
  pkg: 'chat-transcript' | 'rich-document',
  file: 'index.html' | 'app.js' | 'app.css',
): string {
  const abs = path.join(distRoot, pkg, file);
  if (!fs.existsSync(abs)) {
    throw new Error(
      `缺少 webview-dist 产物: ${abs}（请先 npm run build:webview）`,
    );
  }
  return fs.readFileSync(abs, 'utf8');
}
