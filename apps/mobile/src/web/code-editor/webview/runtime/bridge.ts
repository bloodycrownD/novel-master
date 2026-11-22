/**
 * code-editor 桥与文档门面（runtime；无 JSX）。
 *
 * 文件名 bridge.ts 按域前缀起名 CodeEditorBridge：三域同名 bridge.ts
 * 语义独立，域前缀自解释。
 */
import {BRIDGE_V, type SetDocumentPayload} from './model';
import {CodeEditor} from './editor';
import {post} from './post';
import {Theme} from './theme';
import {HostMessageChannel} from '@web/shared/host-message-channel';
import type {HostTheme} from './model';

export {post};

export namespace CodeEditorBridge {
    export function handle(raw: unknown): void {
        // 解析 + v/type 校验统一在 shared（web/C-orch-3、web/A-2）：
        // v 不匹配或 type 缺失的消息在此丢弃；对象型 raw 直通（宽容口径）
        const msg = HostMessageChannel.match(raw, BRIDGE_V);
        if (!msg) return;

        if (msg.type === 'init') {
            Theme.apply(msg.payload && (msg.payload.theme as HostTheme | undefined));
            return;
        }

        if (msg.type === 'themeUpdate') {
            Theme.apply(msg.payload && (msg.payload.theme as HostTheme | undefined));
            return;
        }

        if (msg.type === 'setDocument') {
            const payload = (msg.payload ?? {}) as SetDocumentPayload;
            const text = String(payload.text ?? '');
            const path = String(payload.path ?? '');
            let selection: {start: number; end: number} | undefined;
            if (payload.selectionStart != null) {
                selection = {start: payload.selectionStart, end: payload.selectionEnd ?? payload.selectionStart};
            }
            const root = document.getElementById('root');
            if (root && !root.querySelector('.cm-editor')) {
                CodeEditor.mount(root, text, path, selection);
            } else {
                CodeEditor.setDocument(text, path, selection);
            }
            return;
        }

        if (msg.type === 'blur') {
            CodeEditor.blur();
        }
    }
}
