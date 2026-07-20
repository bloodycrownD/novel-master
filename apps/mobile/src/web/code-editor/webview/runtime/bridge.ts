/**
 * code-editor 桥与文档门面（runtime；无 JSX）。
 */
import type { HostTheme, SetDocumentPayload } from './model';
import { blurEditor, mountEditor, setDocument } from './editor';
import { post } from './post';
import { applyTheme } from './theme';

export { post };

export function handleHostMessage(raw: unknown): void {
  let msg: { v?: number; type?: string; payload?: Record<string, unknown> };
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!msg || msg.v !== 1) return;

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
