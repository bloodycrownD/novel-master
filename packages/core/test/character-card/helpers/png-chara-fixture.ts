/**
 * 构造内嵌 `tEXt`/`chara`（或仅 iTXt/zTXt）的最小 PNG fixture。
 *
 * @module test/character-card/helpers/png-chara-fixture
 */

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** PNG CRC 表（多项式 0xedb88320）。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

function writeUInt32BE(view: Uint8Array, offset: number, value: number): void {
  view[offset] = (value >>> 24) & 0xff;
  view[offset + 1] = (value >>> 16) & 0xff;
  view[offset + 2] = (value >>> 8) & 0xff;
  view[offset + 3] = value & 0xff;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = encodeLatin1(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  writeUInt32BE(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  writeUInt32BE(chunk, 8 + data.length, crc32(crcInput));
  return chunk;
}

/** 1×1 RGB IHDR（无 IDAT；仅供 chunk 扫描 fixture）。 */
function buildIhdrChunk(): Uint8Array {
  const data = new Uint8Array(13);
  writeUInt32BE(data, 0, 1); // width
  writeUInt32BE(data, 4, 1); // height
  data[8] = 8; // bit depth
  data[9] = 2; // color type RGB
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return buildChunk("IHDR", data);
}

function buildTextChunk(keyword: string, text: string): Uint8Array {
  const keywordBytes = encodeLatin1(keyword);
  const textBytes = encodeLatin1(text);
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(textBytes, keywordBytes.length + 1);
  return buildChunk("tEXt", data);
}

/**
 * 构造仅含 iTXt/`chara` 的 PNG（无 tEXt）——应用于 T-C6。
 */
function buildItxtCharaChunk(text: string): Uint8Array {
  const keyword = encodeLatin1("chara");
  const textBytes = encodeLatin1(text);
  // keyword\0 compressionFlag compressionMethod language\0 translated\0 text
  const data = new Uint8Array(keyword.length + 1 + 1 + 1 + 1 + 1 + textBytes.length);
  let o = 0;
  data.set(keyword, o);
  o += keyword.length;
  data[o++] = 0;
  data[o++] = 0; // uncompressed
  data[o++] = 0; // method
  data[o++] = 0; // empty language + null
  data[o++] = 0; // empty translated + null
  data.set(textBytes, o);
  return buildChunk("iTXt", data);
}

function buildZtxtCharaChunk(text: string): Uint8Array {
  const keyword = encodeLatin1("chara");
  const textBytes = encodeLatin1(text);
  // 未压缩伪 zTXt：method=0 + raw（扫描器不应接受）
  const data = new Uint8Array(keyword.length + 1 + 1 + textBytes.length);
  data.set(keyword, 0);
  data[keyword.length] = 0;
  data[keyword.length + 1] = 0;
  data.set(textBytes, keyword.length + 2);
  return buildChunk("zTXt", data);
}

function buildPng(chunks: readonly Uint8Array[]): Uint8Array {
  return concatBytes([PNG_SIGNATURE, ...chunks, buildChunk("IEND", new Uint8Array(0))]);
}

function toBase64Utf8(jsonText: string): string {
  const bytes = new TextEncoder().encode(jsonText);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * 合法 IHDR + tEXt chara + IEND PNG bytes。
 */
export function buildPngWithTextChara(card: unknown): Uint8Array {
  const jsonText = typeof card === "string" ? card : JSON.stringify(card);
  const b64 = toBase64Utf8(jsonText);
  return buildPng([buildIhdrChunk(), buildTextChunk("chara", b64)]);
}

/**
 * 仅含 iTXt chara 的 PNG（无 tEXt）→ 应失败且不 JSON 回退。
 */
export function buildPngWithOnlyItxtChara(card: unknown): Uint8Array {
  const jsonText = typeof card === "string" ? card : JSON.stringify(card);
  const b64 = toBase64Utf8(jsonText);
  return buildPng([buildIhdrChunk(), buildItxtCharaChunk(b64)]);
}

/**
 * 仅含 zTXt chara 的 PNG（无 tEXt）。
 */
export function buildPngWithOnlyZtxtChara(card: unknown): Uint8Array {
  const jsonText = typeof card === "string" ? card : JSON.stringify(card);
  const b64 = toBase64Utf8(jsonText);
  return buildPng([buildIhdrChunk(), buildZtxtCharaChunk(b64)]);
}

/**
 * 损坏的 PNG 魔数头（非完整/坏 chunk）。
 */
export function buildBrokenPngBytes(): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff,
  ]);
}
