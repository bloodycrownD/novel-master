/**
 * 流式 markdown 块边界纯函数（spec §6 渲染块级化 / T-N6）。
 *
 * 职责：给定流式累积文本，切出「可安全独立渲染的完整块」与「活跃尾块」。
 * 块边界三件套：空行分段、代码块（fence）闭合、表格闭合。未闭合语法
 * （流中开着的 fence、只有表头还没等到 delimiter 的表格）一律不提交，
 * 整体留在活跃尾块等后续 delta——这是「未闭合语法不提交」的硬约束。
 *
 * 切分安全性依据：每个切分点都落在 markdown-it 的块级边界上（空行 /
 * fence 关闭行之后 / GFM 表格行的末尾），块独立渲染后顺序拼接与整文
 * 渲染在块级结构上等价（段落内懒惰延续等极端形态的视觉近似可接受，
 * 与 streaming-markdown 等流式渲染库的通行取舍一致）。
 *
 * 约束：
 * - 纯函数零依赖：同时被 RN（ChatTranscriptWebView 块感知渲染）与 Jest
 *   直测引用，禁止 import DOM / @web / Preact——RN tsconfig 与 webview
 *   es2018 双端安全。
 * - es2018 兼容：禁 lookbehind 等新正则特性（esbuild target es2018
 *   不转译正则）；本文件只用普通正则与字符扫描。
 * - 不变式：blocks.join('') + activeTail === 输入文本（零丢失零重复，
 *   RN 侧 abort overlay 的全量物化依赖它）。
 */

export type StreamBlockSplit = {
  /** 完整块列表（顺序拼接 + activeTail 还原原文）。 */
  readonly blocks: string[];
  /** 活跃尾块（未闭合语法整体在此，等待后续 delta）。 */
  readonly activeTail: string;
};

type FenceState = {
  /** 开栏 marker 长度（关闭行长度必须不小于它）。 */
  readonly len: number;
  /** fence 字符（` 或 ~）。 */
  readonly ch: string;
};

/** fence 开栏行：行首（忽略缩进）至少 3 个 ` 或 ~（info string 允许跟在后面）。 */
const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;

function parseFenceOpen(line: string): FenceState | null {
  const matched = FENCE_OPEN_RE.exec(line.trimStart());
  if (!matched) {
    return null;
  }
  return {len: matched[0].length, ch: matched[0].charAt(0)};
}

/**
 * fence 关闭行：整行（trim 后）只由同字符构成且长度不小于开栏长度。
 * 嵌套 fence（```` 包 ```）由长度比较正确处理：内层短 marker 不闭合外层。
 */
function isFenceClose(line: string, fence: FenceState): boolean {
  const trimmed = line.trim();
  if (trimmed.length < fence.len) {
    return false;
  }
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed.charAt(i) !== fence.ch) {
      return false;
    }
  }
  return true;
}

/**
 * GFM 表格 delimiter 行（| --- | :---: | 形态）：仅由 |、:、-、空白构成，
 * 且同时含 - 与 |。用字符扫描避免新正则特性。
 */
function isTableDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  let hasDash = false;
  let hasPipe = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charAt(i);
    if (c === '-') {
      hasDash = true;
    } else if (c === '|') {
      hasPipe = true;
    } else if (c !== ':' && c !== ' ' && c !== '\t') {
      return false;
    }
  }
  return hasDash && hasPipe;
}

/** 表格体候选行：非空且含 |（header/delimiter/数据行的公共形态）。 */
function isTableRowLike(line: string): boolean {
  return line.trim().length > 0 && line.indexOf('|') !== -1;
}

/**
 * 切分流式累积文本。空行触发的提交是「挂起」语义：只有当空行之后真的
 * 到来非空内容时才生效（防止流尾以 \n 结束、下帧续写同一段落时过早提交
 * 造成段落撕裂）；fence 关闭与表格闭合是确定边界，立即生效。
 */
export function splitStreamBlocks(text: string): StreamBlockSplit {
  const blocks: string[] = [];
  if (text.length === 0) {
    return {blocks, activeTail: ''};
  }
  const lines = text.split('\n');
  // 行首偏移：块切分用字符偏移而非行缓冲 join 重建，保证不变式严格成立
  // （尾随 \n、连续空行的归属零丢失）。
  const lineStart: number[] = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStart[i] = offset;
    offset += lines[i].length + 1;
  }

  let blockStart = 0;
  let blockHasContent = false;
  /** 空行挂起的切分点（下一非空行到达时生效）。 */
  let pendingCut: number | null = null;
  let fence: FenceState | null = null;
  let inTable = false;

  const cutAtOffset = (cutOffset: number) => {
    if (cutOffset <= blockStart) {
      return;
    }
    const piece = text.slice(blockStart, cutOffset);
    blockStart = cutOffset;
    blockHasContent = false;
    inTable = false;
    // 空行路径只在块内有非空内容时切，表格/fence 路径块内必有语法行——
    // piece 恒非空白；防御性保留判断，纯空白不单独成块。
    if (piece.trim().length > 0) {
      blocks.push(piece);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (fence != null) {
      // fence 内任何行（含关闭行）都属于当前块；关闭后块界推到下一行首或文尾
      if (isFenceClose(line, fence)) {
        fence = null;
        cutAtOffset(i + 1 < lines.length ? lineStart[i + 1] : text.length);
      }
      continue;
    }

    const opened = parseFenceOpen(line);
    if (opened != null) {
      if (pendingCut != null) {
        cutAtOffset(pendingCut);
        pendingCut = null;
      }
      fence = opened;
      blockHasContent = true;
      continue;
    }

    if (line.trim().length === 0) {
      if (inTable) {
        // 表格在空行处闭合（空行前切出，空行本身归下一块）
        cutAtOffset(lineStart[i]);
      }
      if (blockHasContent) {
        pendingCut = lineStart[i];
      }
      continue;
    }

    if (pendingCut != null) {
      cutAtOffset(pendingCut);
      pendingCut = null;
    }

    if (inTable) {
      if (!isTableRowLike(line)) {
        // 表格闭合（下一非表格行前切出），当前行成为新块首行
        cutAtOffset(lineStart[i]);
        blockHasContent = true;
      }
      continue;
    }

    // 表格开启：当前行是表格行候选 + 下一行是 delimiter（流尾看不到下一行
    // 时不判定——未闭合语法不提交）
    if (
      isTableRowLike(line) &&
      i + 1 < lines.length &&
      isTableDelimiterRow(lines[i + 1])
    ) {
      inTable = true;
    }
    blockHasContent = true;
  }

  return {blocks, activeTail: text.slice(blockStart)};
}
