/**
 * 尾窗增量 token 计数器（stream-metrics-native ②）：把「逐 delta 的实时 token
 * 估算」从 `ceil(chars / 3.35)` 启发式升级为真 BPE 计数，且**不持有全文**、
 * **不每次全量重算**。
 *
 * 背景与取舍（实测数字为 Node v22 + js-tiktoken 1.0.21 / cl100k_base）：
 * - 全量重算不可行：12,000 字符的纯中文无空白串单次 encode 约 88s（cl100k 的
 *   预分词正则把整段视作一个 piece，BPE 合并近似 O(len²)）、中文含换行 68ms、
 *   英文 3.1ms；
 * - 因此本模块用「已固化前缀 + 尾窗」两段式：`tokens = committedTokens +
 *   encode(尾窗)`，尾窗外的部分只 encode 一次（固化即定型），单次 encode 的
 *   字符数被硬上限 {@link MAX_ENCODE_CHARS} 夹住——纯中文无空白串也被拆成
 *   ≤64 字符的小段，单次 encode 从「88s」量级降到「毫秒」量级。
 *
 * 参数（默认值即双端装配值）：
 * - `tailChars = 24`：尾窗字符数。尾部这段永远留着不固化、每次读值重算——它是
 *   「实时数字贴合真值」的来源（最后一两个字与邻居一起过 BPE）；
 * - `lookbackChars = 8`：固化切点从目标位置向后回看多少个字符去找自然边界
 *   （空白 / 标点）。切在自然边界上，cl100k 的预分词通常也在此断开，边界处
 *   的「断词误差」接近零；
 * - `commitStepChars = 64`：固化步长——尾窗超过 `tailChars + commitStepChars`
 *   才触发一次固化，把 encode 调用摊薄（误差/延迟的主旋钮：调大省调用次数、
 *   但**每次读值要重算的尾窗也更大**、单次 push 更慢）。
 *   默认取 64 是实测定的（Node v22 + cl100k，3,660 字符中文长文按 7 字符
 *   delta 流式推入，真值 5,160 t）：
 *   | commitStepChars | 误差 | 单次 push 峰值 | 均摊 |
 *   | 256（原拟默认） | +0.25% | 5.24ms | 1.22ms |
 *   | 128 | +0.19% | 1.67ms | 0.72ms |
 *   | **64（现默认）** | **+0.31%** | **0.92ms** | **0.47ms** |
 *   | 32 | +0.33% | 0.64ms | 0.34ms |
 *   256 的峰值超过「单次 push ≤2ms」的验收线，故默认收紧到 64（误差只涨
 *   0.06 个百分点）；调用方仍可按 CPU 预算上调该值。
 * - 自保收紧：尾窗「近期无自然边界」（最近 `tailChars + lookbackChars` 个字符
 *   里找不到边界）时，固化阈值降到 `tailChars + MAX_ENCODE_CHARS`——默认参数
 *   下两者相等（不再额外扫描）；把 `commitStepChars` 调大时（如 256）这条会
 *   生效；无空白超长串更快被切走，单次读值不会退化成几十毫秒的长耗时。代价是
 *   该场景下切点只能按固定步长落在词中间，边界误差略升（用误差换延迟）。
 *
 * 失败语义：`encode` 抛错（特殊 token 文本等）分**两条路径**处理，互不掩盖——
 * - **读值路径**（尾窗 encode 失败）：尾窗不被消费、字符不丢，`tokens` 保持
 *   上一次成功读值；首次失败 `console.warn` 一次「尾窗不可编码，保持上一次
 *   读值」，**不计入** {@link IncrementalTokenCounter.unencodableChars}
 *   （本次没丢字，只是暂时读不出）；
 * - **固化路径**（固化段 encode 失败）：按「1 字符 ≈ 1 token」的最坏上界
 *   **兜底计入** `committedTokens`（宁可高估也不丢段，保证 `tokens` 单调不减），
 *   首次失败 `console.warn` 一次并把本次字符数累加到
 *   {@link IncrementalTokenCounter.unencodableChars}；尾窗照常推进（固化路径
 *   存在的意义就是给内存封顶，不能因为失败就无限攒尾窗）。
 *
 * 计数器任何时候都不崩、不倒退。
 *
 * @module infra/tokenizer/logic/incremental-token-counter
 */

/** 注入依赖：`encode` 由宿主绑定（真 tiktoken 或测试假实现）。 */
export interface IncrementalTokenCounterDeps {
  /** 把一段文本编码为 token 数；抛错表示这段文本不可编码（调用方吞掉）。 */
  readonly encode: (text: string) => number;
  /** 尾窗字符数（尾窗每次读值重算），默认可由常量 {@link DEFAULT_TAIL_CHARS} 取。 */
  readonly tailChars?: number;
  /** 固化切点回看 / 边界搜索上限（字符），缺省 {@link DEFAULT_LOOKBACK_CHARS}。 */
  readonly lookbackChars?: number;
  /** 固化步长（字符），缺省 {@link DEFAULT_COMMIT_STEP_CHARS}。 */
  readonly commitStepChars?: number;
}

/** 尾窗增量计数器的读口：`push` 追加、`tokens` 读值、`reset` 归零。 */
export interface IncrementalTokenCounter {
  /** 追加一段增量（不做全量重算；超长增量内部按固定步长批量固化）。 */
  push(delta: string): void;
  /** 当前估算 token 数（已固化前缀 + 尾窗重算；失败时保持上一次成功值）。 */
  readonly tokens: number;
  /**
   * 诊断量：**已按 1:1 兜底计入 `tokens` 的不可编码字符数**（只统计固化路径）。
   *
   * 语义收窄的原因：读值路径失败时尾窗没被消费、没丢字，把它计进来会让这一个
   * 字段同时表达「丢了字」与「暂时读不出」两件事，排查时无法区分。读值路径的
   * 失败只走一次性 `console.warn`。
   *
   * 跨 run 累计（`reset()` **不清零**）——它表达的是「这个计数器一生里吞掉过多少
   * 不可编码字符」，清零会让「切模型后又开始丢字」在日志里消失；随对象消亡即可。
   * 不进入任何投影 / 持久层。
   */
  readonly unencodableChars: number;
  /** 归零（新 run / 换会话）。 */
  reset(): void;
}

/** 尾窗字符数默认值（双端装配口径）。 */
export const DEFAULT_TAIL_CHARS = 24;
/** 边界回看字符数默认值。 */
export const DEFAULT_LOOKBACK_CHARS = 8;
/**
 * 固化步长默认值（尾窗超过 `tailChars + 该值` 触发一次固化）。
 *
 * 取 64 而非更大值：固化步长同时决定「尾窗能长到多少」，而尾窗每次读值都要
 * 重算——实测 256 时中文长文单次 push 峰值 5.24ms（超过 2ms 验收线），64 时
 * 0.92ms（误差仅 +0.06pp）。数值表见模块文档。
 */
export const DEFAULT_COMMIT_STEP_CHARS = 64;

/**
 * 单次 `encode` 的字符数硬上限（内部自保，不对外暴露为旋钮）。
 *
 * 取 64 的依据：纯中文无空白串的 encode 耗时近似 O(len²)（实测 32 字符约
 * 0.77ms、64 字符约 2.9ms、256 字符约 46ms、12,000 字符约 88s），64 字符把
 * 单次调用压在个位数毫秒；同时它又是「无自然边界」尾窗的收紧阈值，让该类文本
 * 的读值成本有界。
 */
const MAX_ENCODE_CHARS = 64;

/** 字符是否为「自然边界起点」（空白或标点；切在它之前不会把词切两半）。 */
function isBoundaryCharCode(code: number): boolean {
  // 空白（空格/制表/换行/不换行空格）
  if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
    return true;
  }
  if (code === 0xa0 || code === 0x3000) {
    return true;
  }
  // CJK 标点（，。！？；：、（）【】《》「」『』…—· 等）
  if (
    (code >= 0x3001 && code <= 0x303f) ||
    (code >= 0xff01 && code <= 0xff65) ||
    code === 0x2026 ||
    code === 0x2014 ||
    code === 0x2018 ||
    code === 0x2019 ||
    code === 0x201c ||
    code === 0x201d
  ) {
    return true;
  }
  // ASCII 标点（. , ! ? ; : ) ] } …）：切在标点前，标点归下一段
  if (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  ) {
    return true;
  }
  return false;
}

/**
 * 在 `(to - lookback, to]` 区间里从后往前找自然边界切点；找不到就返回 `to`。
 *
 * 切点语义：返回 i 表示切成 `text[0, i)` + `text[i, ...)`，`text[i]` 是边界
 * 字符（空白/标点）——空白归下一段，与 BPE 预分词「前导空格随词」的口径一致。
 */
function chooseCut(
  text: string,
  from: number,
  to: number,
  lookback: number,
): number {
  const lower = Math.max(from, to - lookback);
  const upper = Math.min(to, text.length - 1);
  for (let i = upper; i >= lower; i -= 1) {
    if (i <= 0) {
      continue;
    }
    if (isBoundaryCharCode(text.charCodeAt(i))) {
      return i;
    }
  }
  return to;
}

/** 区间 `[from, to)` 内是否有自然边界字符（含 to 处？不含——只看段内）。 */
function hasBoundaryInRange(text: string, from: number, to: number): boolean {
  for (let i = Math.max(0, from); i < Math.min(text.length, to); i += 1) {
    if (isBoundaryCharCode(text.charCodeAt(i))) {
      return true;
    }
  }
  return false;
}

/**
 * 建一个尾窗增量计数器。
 *
 * 内部只保留尾窗片段（≤ `tailChars + commitStepChars`，且无边界串会更快被
 * 固化），不持有全文；`tokens` 读值重算尾窗（分段 encode，单段 ≤64 字符）。
 */
export function createIncrementalTokenCounter(
  deps: IncrementalTokenCounterDeps,
): IncrementalTokenCounter {
  const encode = deps.encode;
  const tailChars = Math.max(0, Math.floor(deps.tailChars ?? DEFAULT_TAIL_CHARS));
  const lookbackChars = Math.max(
    0,
    Math.floor(deps.lookbackChars ?? DEFAULT_LOOKBACK_CHARS),
  );
  const commitStepChars = Math.max(
    1,
    Math.floor(deps.commitStepChars ?? DEFAULT_COMMIT_STEP_CHARS),
  );

  /** 已固化前缀的 token 数（只增不减）。 */
  let committedTokens = 0;
  /** 未固化尾窗（字符）。 */
  let tail = "";
  /** 尾窗读值缓存；null = 上次尾窗编码失败（读值回落 lastGoodTokens）。 */
  let tailTokens: number | null = 0;
  let tailDirty = false;
  /** 最近一次成功读值（编码失败时对外保持它）。 */
  let lastGoodTokens = 0;
  /**
   * 已按 1:1 兜底计入的不可编码字符数（诊断量，只统计固化路径；`reset()` 不清）。
   */
  let unencodableCharsValue = 0;
  /**
   * 两条失败路径各一个「已告警」标志——**必须分开**。
   *
   * 固化与读值是两种语义完全不同的失败（兜底计入 vs 保持上次读值），共用一个
   * 标志会让「先发生过一次读值失败」把后续的固化失败静默掉，而固化失败才是
   * 「静默丢字符」这条要治的问题。
   */
  let warnedCommitFailure = false;
  let warnedReadFailure = false;

  /** 单次 encode 的失败安全包装：抛错 → null。 */
  const encodeChunk = (text: string): number | null => {
    try {
      return encode(text);
    } catch {
      return null;
    }
  };

  /**
   * 把一段文本按「自然边界优先、固定步长兜底」拆成 ≤
   * {@link MAX_ENCODE_CHARS} 字符的小段逐一 encode；任一小段失败即返回 null
   * （调用方按「本次不可编码」处理，保持上一次读值）。
   */
  const encodePiece = (text: string): number | null => {
    if (text.length === 0) {
      return 0;
    }
    let total = 0;
    let start = 0;
    while (start < text.length) {
      const hardEnd = Math.min(text.length, start + MAX_ENCODE_CHARS);
      const end = chooseCut(text, start + 1, hardEnd, lookbackChars);
      const chunkTokens = encodeChunk(text.slice(start, end));
      if (chunkTokens === null) {
        return null;
      }
      total += chunkTokens;
      start = end;
    }
    return total;
  };

  /** 读尾窗 token 数（脏了才重算；失败保持 null）。 */
  const readTailTokens = (): number | null => {
    if (tailDirty) {
      tailTokens = encodePiece(tail);
      tailDirty = false;
      if (tailTokens === null && !warnedReadFailure) {
        warnedReadFailure = true;
        // 读值路径此前完全静默，「尾窗读不出来、指标条卡在某个数上」在真机上零
        // 信号；本条告警是该现象唯一的可观测落点。首次打一次，后续静默防刷屏。
        // 注意：本次没丢字（尾窗未消费），故不进 unencodableChars。
        console.warn(
          '[novel-master/incremental-token-counter] 尾窗不可编码，保持上一次读值',
        );
      }
    }
    return tailTokens;
  };

  /** 固化：把尾窗超出部分（≥1 字符）切下来计入 committedTokens。 */
  const commitOnce = (): void => {
    const target = tail.length - tailChars;
    const cut = chooseCut(tail, 1, target, lookbackChars);
    const piece = tail.slice(0, cut);
    const pieceTokens = encodePiece(piece);
    if (pieceTokens !== null) {
      committedTokens += pieceTokens;
    } else {
      // 兜底计入：按「1 字符 ≈ 1 token」的最坏上界计，宁可高估也不丢段——
      // 旧实现只跳过 committedTokens 却照常推进 tail，这一段字符会永久蒸发，
      // 且因为「固化部分没加、尾窗又短了」导致 tokens 读值倒退。
      committedTokens += piece.length;
      unencodableCharsValue += piece.length;
      if (!warnedCommitFailure) {
        warnedCommitFailure = true;
        console.warn(
          `[novel-master/incremental-token-counter] 不可编码 ${piece.length} 字符，按 1:1 兜底计入`,
        );
      }
    }
    // 尾窗照常推进（切点在失败时同样有效）：固化路径的意义就是给内存封顶，
    // 不能因为 encode 失败就无限攒尾窗。
    tail = tail.slice(cut);
  };

  return {
    push(delta: string): void {
      if (delta.length === 0) {
        return;
      }
      tail += delta;
      const normalLimit = tailChars + commitStepChars;
      const tightLimit = tailChars + MAX_ENCODE_CHARS;
      // 收紧仅在「固化步长比单次 encode 上限更大」时有意义（默认两者相等，
      // 不做无谓的边界扫描）。
      const tightMode =
        tightLimit < normalLimit &&
        tail.length > tightLimit &&
        !hasBoundaryInRange(
          tail,
          tail.length - tailChars - lookbackChars,
          tail.length,
        );
      while (tail.length > normalLimit || (tightMode && tail.length > tightLimit)) {
        commitOnce();
      }
      tailDirty = true;
    },
    get tokens(): number {
      const current = readTailTokens();
      if (current === null) {
        // 本次尾窗不可编码（特殊 token 文本等）：保持上一次成功读值。
        return lastGoodTokens;
      }
      lastGoodTokens = committedTokens + current;
      return lastGoodTokens;
    },
    get unencodableChars(): number {
      return unencodableCharsValue;
    },
    reset(): void {
      committedTokens = 0;
      tail = "";
      tailTokens = 0;
      tailDirty = false;
      lastGoodTokens = 0;
      // unencodableChars 刻意不清零：它是跨 run 的累计诊断量（见接口注释）。
    },
  };
}
