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

/** http(s) 外跳判定单源（mobile RN / desktop renderer / desktop main 三端共用）。 */
const HTTPS_PATTERN = /^https?:\/\//i;

/**
 * 判定 href 是否为 http(s) 外部链接（大小写不敏感）。
 *
 * 三端（链接路由、导航拦截、新窗口拦截）统一消费本判定，
 * 避免各入口自持正则导致口径漂移。
 */
export function isHttpUrl(href: string): boolean {
  return HTTPS_PATTERN.test(href);
}

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

/** 省略显示长度门槛（字符数）：路径超过该长度且层数 >2 才做中间省略。 */
const ELIDE_PATH_MIN_LENGTH = 20;

/**
 * 超长路径省略显示：保留首段目录 + `...` + 文件名（对齐工作区路径中省
 * 略的视觉口径），如 `/测试/1/1/.../不存在的文件.md` → `/测试.../不存在的文件.md`。
 * 入参应为归一化绝对逻辑路径（/ 开头、无空段无尾斜杠，即
 * resolveChatLinkTarget/resolveLogicalPath 的产出形态）；短路径（两段内或
 * 未超过 ELIDE_PATH_MIN_LENGTH）原样返回；文件名/首段本身超长不截断。
 */
export function elideChatLinkPath(path: string): string {
  const parts = path.split("/").filter(p => p.length > 0);
  // 拍板口径是「超长才省」：段数>2 且超过显示长度门槛才省略，短而深的路径
  // （如 /notes/2026/x.md）完整显示；文件名/首段本身超长不截断（显示层自适应）。
  if (parts.length <= 2 || path.length <= ELIDE_PATH_MIN_LENGTH) {
    return path;
  }
  return `/${parts[0]!}.../${parts[parts.length - 1]!}`;
}

/**
 * 聊天路径链接未命中的提示文案：`{省略路径} 不存在`（2026-09-12 用户拍板
 * 措辞；超长路径经 elideChatLinkPath 中间省略，双端同口径）。
 */
export function chatLinkNotFoundMessage(path: string): string {
  return `${elideChatLinkPath(path)} 不存在`;
}
