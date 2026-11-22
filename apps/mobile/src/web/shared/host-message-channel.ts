/**
 * 宿主 → WebView message 通道统一接线（三 webview 域共用）。
 *
 * RN WebView 在 Android 走 document 的 message 事件、iOS 走 window 的，
 * 双通道都要注册；解析口径采 chat 宽容版：字符串按 JSON.parse、
 * 对象型 raw 直通（宿主直接 postMessage 对象时不丢消息）。
 */

type HostMessage = {
    v?: number;
    type?: string;
    payload?: Record<string, unknown>;
};

type HostMessageHandler = (raw: unknown) => void;

export namespace HostMessageChannel {
    /** 解析宿主消息：字符串按 JSON、对象直通；坏输入返回 null（消息丢弃）。 */
    export function parse(raw: unknown): HostMessage | null {
        let msg: HostMessage;
        try {
            msg = typeof raw === 'string' ? JSON.parse(raw) : (raw as HostMessage);
        } catch {
            return null;
        }
        if (!msg || typeof msg !== 'object') {
            return null;
        }
        return msg;
    }

    /** 解析 + 版本与 type 校验：任一不满足返回 null（消息丢弃）。 */
    export function match(raw: unknown, bridgeV: number): HostMessage | null {
        const msg = parse(raw);
        if (!msg || msg.v !== bridgeV || !msg.type) {
            return null;
        }
        return msg;
    }

    /** 统一 document + window 双注册（每 webview 入口调用一次）。 */
    export function bind(handler: HostMessageHandler): void {
        const onMessage = (event: MessageEvent | {data?: unknown}) => {
            const data = event && event.data;
            if (data == null) return;
            handler(data);
        };
        document.addEventListener('message', onMessage as EventListener);
        window.addEventListener('message', onMessage as EventListener);
    }
}
