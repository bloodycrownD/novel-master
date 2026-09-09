/**
 * 聊天 markdown 文件链接的目标识别（纯函数，mobile RN / desktop renderer 双端单源）。
 *
 * 职责：把 `<a href>` 的原始字符串识别为「工作区逻辑路径」或「非工作区目标」。
 * 只做识别与归一化，不做存在性探测（探测由宿主侧按 VFS list/read 原语完成）。
 *
 * 识别顺序（依 chat-link-file-nav spec）：
 * 1. URL 解码：markdown 渲染产物里中文路径通常被编码（真机样本实测），
 *    非法百分号序列（如裸 `%ZZ`）解码抛错 → 返回 null；
 * 2. scheme 检测：`scheme:` 形态（含 `HTTP://` 大写、`mailto:`、`C:` 盘符）
 *    一律不是工作区路径 → null；
 * 3. 协议相对地址：`//host/path` → null；
 * 4. 剥 `#fragment`：剥完为空说明是纯锚点（webview 侧本就放行，不进本函数）；
 * 5. resolveLogicalPath 归一化（相对路径补前导 `/`、消解 `.`/`..`），
 *    `INVALID_PATH`（如 `..` 越根、空串）→ null。
 *
 * @module domain/chat/resolve-chat-link-target
 */

import { resolveLogicalPath } from "../../vfs/logic/vfs-path-mapper.js";

/** scheme 起始形态：字母开头 + 字母/数字/`+`/`.`/`-` + `:`（大小写不敏感）。 */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * 识别聊天链接 href 是否指向工作区文件。
 *
 * @param href - `<a>` 元素的原始 href（未解码）
 * @returns 归一化后的工作区逻辑路径（如 `/笔记/大纲.md`）；非工作区目标返回 null
 */
export function resolveChatLinkTarget(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // markdown 渲染器会把中文等非 ASCII 字符编码进 href，先解码再识别；
  // 裸 `%` 或非法序列 decodeURIComponent 会抛 URIError，按不可识别处理
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }

  // http(s)/mailto/大写 scheme/C: 盘符等 scheme 形态都不是工作区路径
  if (SCHEME_PATTERN.test(decoded)) {
    return null;
  }
  // `//host/path` 协议相对地址交给外跳链路，不是工作区路径
  if (decoded.startsWith("//")) {
    return null;
  }

  // 剥 `#fragment`（锚点不影响文件目标）；剥完为空 = 纯锚点
  const hashIndex = decoded.indexOf("#");
  const pathPart = hashIndex >= 0 ? decoded.slice(0, hashIndex) : decoded;
  if (pathPart.trim().length === 0) {
    return null;
  }

  try {
    return resolveLogicalPath(pathPart);
  } catch {
    // INVALID_PATH：空段越权、`..` 越根等形态
    return null;
  }
}
