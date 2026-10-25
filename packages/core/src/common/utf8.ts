/**
 * UTF-8 字节计量。
 *
 * @module common/utf8
 */

/** 惰性持有的 TextEncoder；undefined = 未探测，null = 运行时无该全局。 */
let textEncoder: TextEncoder | null | undefined;

/**
 * 计算字符串的 UTF-8 字节数（Node 与 RN/Hermes 两侧结果一致）。
 *
 * 优先复用全局 TextEncoder；运行时缺失时按码点手动累计 UTF-8 字节数，
 * 落单代理按替换字符 U+FFFD 计 3 字节（与 TextEncoder 的行为一致）。
 */
export function utf8ByteLength(text: string): number {
  if (textEncoder === undefined) {
    textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  }
  if (textEncoder != null) {
    return textEncoder.encode(text).byteLength;
  }
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}
