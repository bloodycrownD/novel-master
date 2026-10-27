/**
 * composer token 链路纯函数层（composer-native-2026-10 Step 3 · D3 水化路径）：
 * 明文 → token 区间 → 胶囊 markdown 合成。
 *
 * **正则真源不变（D1）**：token 的识别永远以 `composer-highlight.ts` 的
 * `COMPOSER_TOKEN_RE` / `composerTokenRanges` 为准（打字高亮、发送扫描
 * `scanAtPathAttachments`、原子删 `tryAtomicRangeDelete` 全部建在它上面），
 * 本模块只做「区间下发」与「合成 markdown」两件事，不引入第二套识别口径。
 *
 * ## 合成形态（D3）
 *
 * `@path` → `[@path](nmtoken://path)`、`$name` → `[$name](nmskill://name)`。
 * 合成结果只喂给库的 `setValue`（水化 / 命令式写入），库解析出 LINK range 后
 * 由 `linkVariants`（`^nmtoken:` / `^nmskill:`）渲染成胶囊；发送语义继续吃
 * `onChangeText` 的明文，markdown 形态不参与发送。
 *
 * ## 为什么**没有** plainTextFromMarkdown（语义边界）
 *
 * 本模块刻意不提供「markdown → 明文」的反解函数。明文真源永远来自库的
 * `onChangeText`（原生侧编辑器 CharSequence 本身就是明文，Kotlin 侧
 * `InputEventEmitter.emitChangeText` 直发，与序列化无关）；markdown 只是
 * `setValue` 的**入口形态**，进去之后库就拆回明文 + LINK range 了。若在这里
 * 再养一份「从 markdown 反解明文」的路径，明文真源就分叉成两份，D6 的
 * 「最后已知明文」基线会失去唯一出处——任何想从 markdown 拿明文的调用方，
 * 都应该等 `onChangeText` 回报。
 */
import type {ComposerDraftTokenRange} from '@novel-master/core/chat';
import {composerTokenRanges} from '../composer-highlight';

/**
 * token 完整区间（含触发符；end 为开区间下标）。
 *
 * 复用 core 草稿 schema 导出的 `ComposerDraftTokenRange`（D1）：持久化层与 UI
 * 层共用同一结构类型，避免 storage → UI 组件目录的反向依赖。形状同构
 * `{ start, end }`，`end` 为开区间。
 */
export type TokenRange = ComposerDraftTokenRange;

/** `nmtoken://` scheme：`@` 文件引用 token 的链接 destination 前缀（D3）。 */
const NM_TOKEN_SCHEME = 'nmtoken://';

/** `nmskill://` scheme：`$` 技能 token 的链接 destination 前缀（D3）。 */
const NM_SKILL_SCHEME = 'nmskill://';

/**
 * 扫描明文，返回全部 token 区间（按出现顺序，互不重叠）。
 *
 * 定位（D1 后）：**undefined 兜底 + 发送/测试辅助**——运行期水化优先用持久化
 * tokenRanges（scan 只在草稿无 ranges 时兜底）；发送链与测试仍用它取区间。
 * 保留这层转发壳是为了让下发链（NativeChatComposer 与测试）读起来语义直达，
 * 也方便日后在此追加 mobile 侧专属的识别微调而不动桌面对齐的正则真源。
 */
export function scanTokensToRanges(text: string): readonly TokenRange[] {
  return composerTokenRanges(text);
}

/**
 * 单编辑区差分重映射（胶囊确认制的编辑侧核心，2026-10-07 真机轮拍板）。
 *
 * 语义前提：胶囊区间只在「引用落文」（typeahead / 选择器插入）与水化引导时
 * 产生；此后的**任何**文本编辑都不并入胶囊——
 * - 编辑区（prev 与 next 的单处差异段）与某区间**有重叠** → 该区间摘除
 *   （胶囊中段被改动即不再是那条引用）；
 * - 编辑区在区间**左侧贴边**（插入点 == 区间 start）→ 区间整体右移保留；
 * - 编辑区在区间**右侧贴边**（插入点 == 区间 end）→ 区间原位保留，插入的
 *   字符落在区间之外（「胶囊边缘不空格继续打字被并进胶囊」的修复点）；
 * - 区间整体在编辑区左侧 → 不动；整体在右侧 → 平移 delta。
 *
 * 多处差异（全量 setValue / 全屏编辑回填）会被折叠为一个编辑区处理：区间
 * 落在区外的照常平移，跨编辑区的摘除——保守但可预测。
 *
 * **纯插入的光标锚（2026-10-20 真机轮）**：文本对齐在「插入内容与邻接文本
 * 共享字符」时会把插入点咬进公共前缀（典型：新胶囊 `$B` 插在旧胶囊 `$A` 头
 * 部——公共前缀吃掉 `$`，对齐插入点落进旧区间内部 → 旧胶囊被误摘，表现为
 * 「连插两颗只剩一颗」）。纯编辑区为空（纯插入）且调用方给出编辑后光标
 * （引用落文 / 命令式提交恒有）时，用 `光标 - 插入长度` 反推真实插入点，
 * 并以前缀/后缀一致性守卫反推结果的合法性；守卫不过或未传光标则维持对齐
 * 点（打字路径不传光标：手输落进胶囊内部本就摘除，语义一致）。
 *
 * **删除锚（D11，2026-10-21 真机轮）**：净删除（`delta < 0`）时，同一套
 * 公共前后缀对齐会把删除点咬进幸存胶囊内部——相邻胶囊删左颗（`$A$B` 退格
 * 原子删 A → `$B`）：公共前缀吃掉 `$`，对齐编辑区 `[1,3)` 同时盖住 A 尾与
 * B 头，保守口径把两颗一并摘除。与插入锚同构，用**编辑前光标**反推真实删除
 * 段 `D`（编辑前后光标差区间），区间与 D **有公共字符**（端点相触不算）才
 * 摘除，其余按 `delta` 平移——A 在 D 内被摘、B 贴右端点相触而幸存。D 的
 * 合法性用「`prev` 去掉 D 后逐字等于 `next`」守卫（纯删除一致性）；守卫不过
 * 或未传编辑前光标则**回退原差分口径**（只增强不回退）。删除锚与插入锚按
 * `delta` 符号分流，互不干扰。
 */
export function remapTokenRanges(
  prev: string,
  next: string,
  ranges: readonly TokenRange[],
  nextCursor?: number,
  prevCursor?: number,
): TokenRange[] {
  if (prev === next) {
    return [...ranges];
  }
  let prefix = 0;
  const maxPrefix = Math.min(prev.length, next.length);
  while (prefix < maxPrefix && prev[prefix] === next[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < prev.length - prefix &&
    suffix < next.length - prefix &&
    prev[prev.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }
  const editStart = prefix;
  const editEndPrev = prev.length - suffix;
  const delta = next.length - prev.length;
  // 删除锚（D11）：净删除且编辑前光标可用时，用光标差反推真实删除段；
  // 解析失败（守卫不过 / 未给光标）落回下面的差分口径。
  if (delta < 0) {
    const deletion = resolveDeletionSpan(
      prev,
      next,
      editStart,
      editEndPrev,
      delta,
      nextCursor,
      prevCursor,
    );
    if (deletion != null) {
      return remapAroundDeletion(ranges, deletion, delta);
    }
  }
  let anchor = editStart;
  if (editStart === editEndPrev && nextCursor != null) {
    // 纯插入：插入段长 = delta，真实插入点 = 光标 - delta。
    const inferred = nextCursor - delta;
    const plausible =
      Number.isInteger(inferred) &&
      inferred >= 0 &&
      inferred <= prev.length &&
      next.startsWith(prev.slice(0, inferred)) &&
      next.endsWith(prev.slice(inferred));
    if (plausible) {
      anchor = inferred;
    }
  }
  const remapped: TokenRange[] = [];
  // 纯插入（编辑区在 prev 侧为空）时左右边界同为一个插入点（可能已被光标锚
  // 修正）；替换场景维持原双边界：跨编辑区的区间一律摘除。
  const pureInsert = editStart === editEndPrev;
  const leftBound = pureInsert ? anchor : editStart;
  const rightBound = pureInsert ? anchor : editEndPrev;
  for (const range of ranges) {
    if (range.end <= leftBound) {
      remapped.push({start: range.start, end: range.end});
    } else if (range.start >= rightBound) {
      remapped.push({start: range.start + delta, end: range.end + delta});
    }
    // 其余情形（区间跨插入点 / 与编辑区相交）一律摘除，不做部分保留。
  }
  return remapped;
}

/**
 * 删除锚的删除段解析（D11）：由编辑前光标反推真实删除区间 `[start, end)`。
 *
 * 候选删除段按优先级取：
 * 1. 调用方显式给的编辑后光标（命令式通道的 `cursor`）——两光标直接构成 D；
 * 2. 光标在差分编辑区右缘（`prevCursor >= editEndPrev`，退格 / 选区删除的
 *    常态）——删除段在光标左侧：`[prevCursor + delta, prevCursor)`；
 * 3. 光标在差分编辑区左缘（`prevCursor <= editStart`，前向删除）——删除段在
 *    光标右侧、光标原地：`[prevCursor, prevCursor - delta)`；
 * 4. 光标落在差分编辑区内（公共前后缀把对齐点咬进邻接文本的歧义区，D11 的
 *    原始缺陷面）——先试退格候选，再试前向候选。
 *
 * 每个候选都过**纯删除一致性**守卫：`prev` 去掉 D 后必须逐字等于 `next`。
 * 这条守卫同时排除「净缩短但不是纯删除」的替换编辑与越界光标——不过即返回
 * null，调用方回退原差分口径（只增强不回退）。
 */
function resolveDeletionSpan(
  prev: string,
  next: string,
  editStart: number,
  editEndPrev: number,
  delta: number,
  nextCursor: number | undefined,
  prevCursor: number | undefined,
): {start: number; end: number} | null {
  if (prevCursor == null) {
    return null;
  }
  if (
    !Number.isInteger(prevCursor) ||
    prevCursor < 0 ||
    prevCursor > prev.length
  ) {
    return null;
  }
  const candidates: Array<{start: number; end: number}> = [];
  if (
    nextCursor != null &&
    Number.isInteger(nextCursor) &&
    nextCursor >= 0 &&
    nextCursor <= next.length
  ) {
    candidates.push({
      start: Math.min(prevCursor, nextCursor),
      end: Math.max(prevCursor, nextCursor),
    });
  }
  if (prevCursor >= editEndPrev) {
    candidates.push({start: prevCursor + delta, end: prevCursor});
  } else if (prevCursor <= editStart) {
    candidates.push({start: prevCursor, end: prevCursor - delta});
  } else {
    candidates.push(
      {start: prevCursor + delta, end: prevCursor},
      {start: prevCursor, end: prevCursor - delta},
    );
  }
  for (const {start, end} of candidates) {
    if (start < 0 || end > prev.length || start >= end) {
      continue;
    }
    if (prev.slice(0, start) + prev.slice(end) === next) {
      return {start, end};
    }
  }
  return null;
}

/**
 * 删除锚的区间分流（D11）：与删除段**有公共字符**（端点相触不算）的区间摘除，
 * 其余幸存——删除段左侧原位、右侧按 `delta`（负）平移。
 */
function remapAroundDeletion(
  ranges: readonly TokenRange[],
  deletion: {start: number; end: number},
  delta: number,
): TokenRange[] {
  const remapped: TokenRange[] = [];
  for (const range of ranges) {
    if (range.start < deletion.end && deletion.start < range.end) {
      continue;
    }
    if (range.end <= deletion.start) {
      remapped.push({start: range.start, end: range.end});
    } else {
      remapped.push({start: range.start + delta, end: range.end + delta});
    }
  }
  return remapped;
}

/**
 * 明文 → 胶囊 markdown 合成（水化 / 命令式 setText 的唯一合成入口）。
 *
 * 逐 token 包成链接、普通段原样拼接；无 token 时原串返回（不做无谓拷贝）。
 *
 * **转义兜底**：token 正文含 `[` / `]` 时会提前终结链接文本（CommonMark 的
 * 链接文本不支持转义方括号），这类 token 退化为**纯明文不合成**——胶囊视觉由
 * `setTokenRanges` 的 TOKEN span 兜底（纯文本 token 同样命中胶囊样式），发送
 * 语义吃明文零影响。destination 里的 `(` / `)` 则走百分号编码（对齐库端
 * `LinkCoordinator.sanitizeUrl` 的括号编码口径），避免破坏链接语法。
 */
export function synthesizeTokenMarkdown(text: string): string {
  return synthesizeTokenMarkdownFromRanges(text, scanTokensToRanges(text));
}

/**
 * 按确认区间合成胶囊 markdown（胶囊确认制的合成侧入口，2026-10-07 真机轮）。
 *
 * 与 {@link synthesizeTokenMarkdown} 的唯一区别：区间由调用方给定（引用落文
 * 登记的确认区间），**不再正则全扫**——手输的 `$xxx` / `@xxx` 不合成链接、
 * 不成胶囊。区间须按 start 升序且互不重叠（登记与重映射的产物天然满足）。
 * 越界/翻转/负下标的非法区间一律跳过（跳到下一区间，其余段照常拼接）——纯
 * 防御，见循环内守卫注释。
 */
export function synthesizeTokenMarkdownFromRanges(
  text: string,
  ranges: readonly TokenRange[],
): string {
  if (ranges.length === 0) {
    return text;
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const range of ranges) {
    // 守卫：负 start 会让 slice(cursor, -1) 改为按 from-end 切、切出错拼文本；
    // end < start 的翻转区间同理。上游数学上不产出非法区间，这里是纯防御缺口
    // （登记/重映射的产物天然合法，坏数据从外部调用方进来时才见）。
    if (
      range.start < 0 ||
      range.end < range.start ||
      range.end > text.length ||
      range.start < cursor
    ) {
      continue;
    }
    parts.push(text.slice(cursor, range.start));
    parts.push(synthesizeToken(text.slice(range.start, range.end)));
    cursor = range.end;
  }
  parts.push(text.slice(cursor));
  return parts.join('');
}

/** 单个 token（形如 `@path@` / `$name$`）→ 链接 markdown；不可合成时原样返回。 */
function synthesizeToken(token: string): string {
  // 终止符 = 触发符同字符：先做形态校验，首尾不同字符一律原文返回（半截 token 不成胶囊）
  if (token.length < 3 || token[0] !== token[token.length - 1]) {
    return token;
  }
  const indicator = token[0];
  // 剥掉两端触发符：destination 只留 body，LINK 文本保留完整明文（native 侧回声逐字一致）
  const body = token.slice(1, -1);
  if (body.length === 0) {
    return token;
  }
  // 链接文本破坏字符：不合成（理由见 synthesizeTokenMarkdown 的转义兜底说明）
  if (body.includes('[') || body.includes(']')) {
    return token;
  }
  const scheme = indicator === '@' ? NM_TOKEN_SCHEME : NM_SKILL_SCHEME;
  const destination = scheme + encodeDestination(body);
  return `[${token}](${destination})`;
}

/** destination 的括号百分号编码（对齐库端 `LinkCoordinator.sanitizeUrl`）。 */
function encodeDestination(body: string): string {
  return body.replace(/\(/g, '%28').replace(/\)/g, '%29');
}
