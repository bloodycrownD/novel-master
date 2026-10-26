/**
 * 角色卡导入与读取侧的体积/条目上限常量。
 *
 * 背景：巨大角色卡（几十 MB 的 PNG/JSON）在导入解析链上会产生多份全尺寸拷贝，
 * 触发原生 OOM（非 JS 异常，try/catch 拦不住、直接杀进程）；毒数据落库后，
 * 每次重启的 workplace 前缀组装还会整读全文，形成「重启必崩」的崩溃循环。
 * 本模块集中定义两道闸门的阈值：
 *
 * - 导入侧（防新增）：`importFromBytes` 入口 + md 树三闸（内联在 character-card-import.service）
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
export const CHARACTER_CARD_BLOB_COMPRESSED_GATE_BYTES = CHARACTER_CARD_MAX_SINGLE_FILE_BYTES / 4;
