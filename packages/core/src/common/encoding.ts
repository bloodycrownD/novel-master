/**
 * 字节与文本编码类工具：base64 编解码、UTF-8 字节计量。
 *
 * @module common/encoding
 */

/**
 * 惰性持有的 TextEncoder 槽（模块内 holder，对象管理，不裸露离散 let）；
 * `undefined` = 未探测，`null` = 运行时无该全局。
 */
const textEncoderSlot = {
    current: undefined as TextEncoder | null | undefined,
};

export const Encoding = {
        /** 解码 base64 文本（纯 JS atob，Node / RN 通用）。 */
        base64ToBytes: (base64: string): Uint8Array =>
                Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),

        /** 编码字节序列为 base64 文本；按 0x8000 切段，避免超大 spread 撑爆调用栈。 */
        bytesToBase64: (bytes: Uint8Array): string => {
                const chunkSize = 0x8000;
                let binary = "";
                for (let i = 0; i < bytes.length; i += chunkSize) {
                        const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
                        binary += String.fromCharCode(...slice);
                }
                return globalThis.btoa(binary);
        },

        /**
     * 计算字符串的 UTF-8 字节数（Node 与 RN/Hermes 两侧结果一致）。
     *
     * 优先复用全局 TextEncoder；运行时缺失时按码点手动累计 UTF-8 字节数，
     * 落单代理按替换字符 U+FFFD 计 3 字节（与 TextEncoder 的行为一致）。
     */
        utf8ByteLength: (text: string): number => {
                if (textEncoderSlot.current === undefined) {
                        textEncoderSlot.current = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
                }
                if (textEncoderSlot.current != null) {
                        return textEncoderSlot.current.encode(text).byteLength;
                }
                let bytes = 0;
                for (const char of text) {
                        const code = char.codePointAt(0)!;
                        let size: number;
                        if (code < 0x80) {
                                size = 1;
                        } else if (code < 0x800) {
                                size = 2;
                        } else if (code < 0x10000) {
                                size = 3;
                        } else {
                                size = 4;
                        }
                        bytes += size;
                }
                return bytes;
        },
} as const;
