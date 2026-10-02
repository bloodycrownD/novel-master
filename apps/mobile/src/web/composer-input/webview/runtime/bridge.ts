/**
 * composer-input 桥：host→web 消息接线 + web→host post 出口（runtime；无 JSX）。
 *
 * 解析 + v/type 校验统一在 shared（`matchHostMessage`）：JSON 坏、v 不符、type 缺失
 * 一律静默丢弃；web→host 只经本文件绑定的 post，消息头 `v` 恒为本包 BRIDGE_V。
 */
import {matchHostMessage} from '@web/shared/host-message-channel';
import {createBoundPost} from '@web/shared/post';
import {BRIDGE_V, type ComposerTheme, type InitPayload} from './model';
import {
  applyDisabled,
  applyInit,
  applySelection,
  applyText,
  applyTheme,
  blurComposerInput,
} from './editor';

export const post = createBoundPost(BRIDGE_V);

function payloadOf(msg: {
  payload?: Record<string, unknown>;
}): Record<string, unknown> {
  return msg.payload ?? {};
}

export function handleHostMessage(raw: unknown): void {
  const msg = matchHostMessage(raw, BRIDGE_V);
  if (!msg) {
    return;
  }

  switch (msg.type) {
    case 'init':
      applyInit(payloadOf(msg) as Partial<InitPayload>);
      return;
    case 'themeUpdate':
      applyTheme(payloadOf(msg).theme as ComposerTheme | undefined);
      return;
    case 'setText': {
      const payload = payloadOf(msg);
      const text = String(payload.text ?? '');
      const start =
        typeof payload.selectionStart === 'number'
          ? payload.selectionStart
          : undefined;
      const end =
        typeof payload.selectionEnd === 'number'
          ? payload.selectionEnd
          : undefined;
      applyText(text, start, end);
      return;
    }
    case 'setSelection':
      applySelection(
        Number(payloadOf(msg).start ?? 0),
        Number(payloadOf(msg).end ?? 0),
      );
      return;
    case 'setDisabled':
      applyDisabled(payloadOf(msg).disabled === true);
      return;
    case 'blur':
      blurComposerInput();
      return;
    default:
      // 未知 type：协议内不存在的消息（含其它管线遗留的死消息）丢弃
      return;
  }
}
