/**
 * 角色卡导入与读取侧的体积/条目上限常量。
 *
 * 背景：巨大角色卡（几十 MB 的 PNG/JSON）在导入解析链上会产生多份全尺寸拷贝，
 * 触发原生 OOM（非 JS 异常，try/catch 拦不住、直接杀进程）；毒数据落库后，
 * 每次重启的 workplace 前缀组装还会整读全文，形成「重启必崩」的崩溃循环。
 * 本模块集中定义两道闸门的阈值：
 *
 * - 导入侧（防新增）：`importFromBytes` 入口 + md 树三闸（见 validate-md-tree-limits）
 * - 读取侧（救存量、保启动存活）：workplace 前缀组装对超大文件降级为占位符
 *
 * @module domain/character-card/logic/character-card-limits
 */

/** 原始输入（PNG / JSON 文件本体）的最大字节数，超过即拒绝导入（防解析链 OOM）。 */
export const CHARACTER_CARD_MAX_INPUT_BYTES = 48 * 1024 * 1024;

/** 导入生成的 md 树全部文件 content 的 UTF-8 字节总量上限（对齐 ZIP 32MB）。 */
export const CHARACTER_CARD_MAX_TOTAL_CONTENT_BYTES = 32 * 1024 * 1024;

/** md 树单个文件 content 的 UTF-8 字节上限；读取侧降级闸门复用该值。 */
export const CHARACTER_CARD_MAX_SINGLE_FILE_BYTES = 8 * 1024 * 1024;

/** md 树文件条目数上限（对齐 ZIP 条目数）。 */
export const CHARACTER_CARD_MAX_FILE_COUNT = 5000;

/**
 * 读取侧对 content store 压缩 blob 的闸门（字节）。
 *
 * `vfs_content_blob` 不存明文大小，只有 zlib 压缩后的 `byte_len`；这里按典型
 * 文本压缩比 4× 把单文件上限折算到压缩侧。方向上刻意保守：宁可多跳过（占位符，
 * 应用存活）也不放行会在解压/渲染链上 OOM 的文件。极端高压缩比内容（如大段
 * 重复字符）理论上可绕过，但现实角色卡数据（模型生成的 JSON/文本）压缩比有限，
 * 不会落入该窗口。
 */
export const CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES =
  CHARACTER_CARD_MAX_SINGLE_FILE_BYTES / 4;

/** 惰性持有的 TextEncoder（无该全局时保持 undefined，走手动兜底）。 */
let textEncoder: TextEncoder | undefined;
let textEncoderChecked = false;

/**
 * 计算字符串的 UTF-8 字节数（Node 与 RN/Hermes 两侧结果一致）。
 *
 * 优先复用全局 TextEncoder；运行时缺失时按 UTF-16 码元手动累计 UTF-8 字节数，
 * 正确处理代理对：完整代理对计 4 字节，落单代理按替换字符 U+FFFD 计 3 字节
 * （与 TextEncoder 的行为一致）。
 */
export function utf8ByteLength(text: string): number {
  if (!textEncoderChecked) {
    textEncoderChecked = true;
    if (typeof TextEncoder !== "undefined") {
      textEncoder = new TextEncoder();
    }
  }
  if (textEncoder != null) {
    return textEncoder.encode(text).byteLength;
  }

  // 手动兜底：按 UTF-16 码元逐个折算 UTF-8 字节数
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // 高位代理后面紧跟低位代理 → 一个码点 4 字节，跳过下一个码元
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
        continue;
      }
    }
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else {
      // 含落单代理：TextEncoder 会替换为 U+FFFD（3 字节），这里保持一致
      bytes += 3;
    }
  }
  return bytes;
}
