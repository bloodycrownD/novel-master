/**
 * code-editor 桥与文档门面（runtime；无 JSX）。
 */
import { BRIDGE_V, type SetDocumentPayload } from './model';
import type { HostTheme } from './model';
import { blurEditor, mountEditor, setDocument } from './editor';
import { post } from './post';
import { applyTheme } from './theme';
import { matchHostMessage } from '@web/shared/host-message-channel';

export { post };

export function handleHostMessage(raw: unknown): void {
  // 解析 + v/type 校验统一在 shared（web/C-orch-3、web/A-2）：
  // v 不匹配或 type 缺失的消息在此丢弃；对象型 raw 直通（宽容口径）
  const msg = matchHostMessage(raw, BRIDGE_V);
  if (!msg) return;

  if (msg.type === 'init') {
    applyTheme(msg.payload && (msg.payload.theme as HostTheme | undefined));
    return;
  }

  if (msg.type === 'themeUpdate') {
    applyTheme(msg.payload && (msg.payload.theme as HostTheme | undefined));
    return;
  }

  if (msg.type === 'setDocument') {
    const payload = (msg.payload ?? {}) as SetDocumentPayload;
    const text = String(payload.text ?? '');
    const path = String(payload.path ?? '');
    const root = document.getElementById('root');
    if (root && !root.querySelector('.cm-editor')) {
      mountEditor(root, text, path);
    } else {
      setDocument(text, path);
    }
    return;
  }

  if (msg.type === 'blur') {
    blurEditor();
  }
}
