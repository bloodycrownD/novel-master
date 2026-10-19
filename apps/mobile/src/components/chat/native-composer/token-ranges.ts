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
export const NM_TOKEN_SCHEME = 'nmtoken://';

/** `nmskill://` scheme：`$` 技能 token 的链接 destination 前缀（D3）。 */
export const NM_SKILL_SCHEME = 'nmskill://';

/**
 * 扫描明文，返回全部 token 区间（按出现顺序，互不重叠）。
 *
 * 纯转发 `composerTokenRanges`：留这层壳是为了让下发链（NativeChatComposer
 * 与测试）读起来语义直达，也方便日后在此追加 mobile 侧专属的识别微调而不动
 * 桌面对齐的正则真源。
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
 */
export function remapTokenRanges(
  prev: string,
  next: string,
  ranges: readonly TokenRange[],
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
  const remapped: TokenRange[] = [];
  for (const range of ranges) {
    if (range.end <= editStart) {
      remapped.push({start: range.start, end: range.end});
    } else if (range.start >= editEndPrev) {
      remapped.push({start: range.start + delta, end: range.end + delta});
    }
    // 其余情形（区间与编辑区相交）一律摘除，不做部分保留。
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

/** 单个 token（形如 `@path` / `$name`）→ 链接 markdown；不可合成时原样返回。 */
function synthesizeToken(token: string): string {
  const indicator = token[0];
  const body = token.slice(1);
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
