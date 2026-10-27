/**
 * 用户气泡正文：`@路径` / `$技能` token 渲染为圆角胶囊（与 composer tag 视觉对齐）。
 *
 * 胶囊边界真源 = 消息附件（发送链按胶囊区间扫描挂载，`skillName` / `path` 即
 * token 精确内容）；正文里 `@x`/`$x` 只有捕获内容与附件逐字相等才成胶囊——
 * 尾随文字无空白也能精确切分（`甲$技能文字` → 胶囊 `$技能` + 明文 `文字`），
 * 与输入框 chip 模型语义一致。未挂载的 `$xxx` 明文按正文渲染（chips = 真实引用，
 * 不再按正则猜测伪装）。历史消息无附件命中时同样按明文渲染。
 */
import type {ComponentChildren} from 'preact';

type RefSpan =
  | {kind: 'text'; text: string}
  | {kind: 'path' | 'skill'; text: string};

type RefMatch = {
  index: number;
  end: number;
  text: string;
  kind: 'path' | 'skill';
};

/**
 * 字面量子串搜索：正文里出现 `$<skillName>` / `@<path>` 整串才算命中——
 * 构造即精确边界（任何尾随字符都不吞），与附件逐字相等天然成立。
 * 同位置多名字命中（如技能 `A` 与 `AB`）保留最长（更具体）。
 * path 侧额外接受去前导 `/` 形态：core 扫描落库时把相对路径归一成绝对
 * （`notes/a.md` → `/notes/a.md`），正文保留用户原样 `@notes/a.md`，
 * 双形态探测保证手输相对路径的真实挂载引用也能命中。
 */
function findLiteralTokenMatches(
  text: string,
  trigger: '@' | '$',
  names: Iterable<string>,
  kind: 'path' | 'skill',
): RefMatch[] {
  const out: RefMatch[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (name === '') {
      continue;
    }
    const needles = [name];
    if (kind === 'path' && name.startsWith('/')) {
      needles.push(name.slice(1));
    }
    for (const n of needles) {
      const needle = trigger + n;
      if (seen.has(needle)) {
        continue;
      }
      seen.add(needle);
      let idx = text.indexOf(needle);
      while (idx >= 0) {
        out.push({index: idx, end: idx + needle.length, text: needle, kind});
        idx = text.indexOf(needle, idx + needle.length);
      }
    }
  }
  return out;
}

/** 附件侧的胶囊真源：技能名集合与路径集合（source==='attach'）。 */
export type AttachedRefTokens = {
  skills: Set<string>;
  paths: Set<string>;
};

type AttachLike = {
  source?: string;
  path?: string;
  skillName?: string;
  name?: string;
  action?: string;
};

/** 从消息附件提取胶囊真源（skillAttach → skillName/name；路径附件 → path）。 */
export function attachedRefTokensFrom(
  attachments: readonly AttachLike[],
): AttachedRefTokens {
  const skills = new Set<string>();
  const paths = new Set<string>();
  for (const a of attachments) {
    if (a?.source !== 'attach') {
      continue;
    }
    if (a.action === 'skillAttach') {
      // 转录行附件形状（AttachmentChip）不携带 skillName 字段，回落 name（落库时与 skillName 同值）
      const skill = a.skillName ?? a.name;
      if (typeof skill === 'string' && skill !== '') {
        skills.add(skill);
      }
    } else if (typeof a.path === 'string' && a.path !== '') {
      paths.add(a.path);
    }
  }
  return {skills, paths};
}

/** 正文按附件命中切分为普通文本 / 引用胶囊片段（无命中时原样单段）。 */
export function splitRefTokenSpans(
  text: string,
  attached: AttachedRefTokens,
): RefSpan[] {
  const matches = [
    ...findLiteralTokenMatches(text, '@', attached.paths, 'path'),
    ...findLiteralTokenMatches(text, '$', attached.skills, 'skill'),
  ];
  // 同起始位置取最长命中；再按位置贪心取不重叠区间
  matches.sort((a, b) => a.index - b.index || b.end - a.end);

  const spans: RefSpan[] = [];
  // 所有命中起点：判断「终止符是否已被另一条命中占用」用（旧格式 `$A$B` 两颗粒各自成药丸）
  const matchStarts = new Set(matches.map(match => match.index));
  let cursor = 0;
  for (const match of matches) {
    if (match.index < cursor) continue;
    // 新格式明文 `$A$`：字面量右侧还挂着一颗终止符，消费它才算整颗胶囊。
    // 两个条件必须同时成立——① 该位置字符确实是同一触发符（只查相邻就推进会误吞
    // `$写作文` 这类「附件技能名 + 下一普通字」的正常文本）；② 没有另一条命中恰从这里开始。
    let end = match.end;
    const trigger = match.text[0];
    if (end < text.length && text[end] === trigger && !matchStarts.has(end)) {
      end += 1;
    }
    if (match.index > cursor) {
      spans.push({kind: 'text', text: text.slice(cursor, match.index)});
    }
    // span 文本必须带上被消费的终止符（沿用 match.text 会把它从渲染里丢掉）
    spans.push({kind: match.kind, text: text.slice(match.index, end)});
    cursor = end;
  }
  if (cursor < text.length) {
    spans.push({kind: 'text', text: text.slice(cursor)});
  }
  return spans;
}

/** 用户气泡正文渲染：引用 token 套胶囊样式，其余原样。 */
export function RefTokenText({
  text,
  attached,
}: {
  text: string;
  attached?: AttachedRefTokens;
}): ComponentChildren {
  const spans = splitRefTokenSpans(
    text,
    attached ?? {skills: new Set<string>(), paths: new Set<string>()},
  );
  if (spans.length === 0) {
    return null;
  }
  return (
    <>
      {spans.map((span, index) =>
        span.kind === 'text' ? (
          span.text
        ) : (
          <span
            key={`ref-${index}`}
            className={`ref-token ref-token--${span.kind}`}
          >
            {span.text}
          </span>
        ),
      )}
    </>
  );
}
