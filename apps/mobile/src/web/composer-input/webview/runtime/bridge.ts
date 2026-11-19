/**
 * composer-input 桥：host→web 消息接线 + web→host post 出口（runtime；无 JSX）。
 *
 * 解析 + v/type 校验统一在 shared（`HostMessageChannel.match`）：JSON 坏、v 不符、
 * type 缺失一律静默丢弃；web→host 只经本文件绑定的 post，消息头 `v` 恒为本包
 * BRIDGE_V。
 *
 * 文件名 bridge.ts 按域前缀起名 ComposerBridge：三域同名 bridge.ts 语义独立，
 * 域前缀自解释。
 */
import {HostMessageChannel} from '@web/shared/host-message-channel';
import {Post} from '@web/shared/post';
import {BRIDGE_V, type ComposerTheme, type InitPayload} from './model';
import {ComposerEditor} from './editor';

export const post = Post.bound(BRIDGE_V);

export namespace ComposerBridge {
  function payloadOf(msg: {payload?: Record<string, unknown>}): Record<string, unknown> {
    return msg.payload ?? {};
  }

  export function handle(raw: unknown): void {
    const msg = HostMessageChannel.match(raw, BRIDGE_V);
    if (!msg) {
      return;
    }

    switch (msg.type) {
      case 'init':
        ComposerEditor.applyInit(payloadOf(msg) as Partial<InitPayload>);
        return;
      case 'themeUpdate':
        ComposerEditor.applyTheme(payloadOf(msg).theme as ComposerTheme | undefined);
        return;
      case 'setText': {
        const payload = payloadOf(msg);
        const text = String(payload.text ?? '');
        const start = typeof payload.selectionStart === 'number' ? payload.selectionStart : undefined;
        const end = typeof payload.selectionEnd === 'number' ? payload.selectionEnd : undefined;
        ComposerEditor.applyText(text, start, end);
        return;
      }
      case 'setSelection':
        ComposerEditor.applySelection(Number(payloadOf(msg).start ?? 0), Number(payloadOf(msg).end ?? 0));
        return;
      case 'setDisabled':
        ComposerEditor.applyDisabled(payloadOf(msg).disabled === true);
        return;
      case 'blur':
        ComposerEditor.blur();
        return;
      default:
        // 未知 type：协议内不存在的消息（含其它管线遗留的死消息）丢弃
        return;
    }
  }
}
