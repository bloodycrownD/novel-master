/**
 * chat-conversation typeahead **web 自治**的纯逻辑层（spec §typeahead 自治）。
 *
 * 为什么要自治：候选 query 的计算与点选插入从「跨桥 RN 算 → 下行 setText」变成
 * 同文档函数调用，零跨桥时序（RN 只保留 Picker 路径 → `dockAction.atPicker` /
 * `skillPicker` → RN Modal → 选择后 `setText` 下发）。
 *
 * 三个真源函数按 `@` 别名入 web bundle（core 入 web 有先例：
 * `chat-transcript/webview/runtime/render/row-logic.ts:6` 已 import `@novel-master/core/chat`）：
 * - `findActiveAtQuery` / `filterAtPathTypeaheadCandidates` / `formatComposerAtPathToken`
 *   —— `@novel-master/core/chat`（RN 侧经 `composer-at-path.ts` re-export）；
 * - `filterSkillTypeaheadCandidates` —— `@/components/chat/skill-typeahead-filter`
 *   （前置抽取出的纯 .ts，原先住在 import 了 react-native 的 `SkillTypeahead.tsx`，
 *   直接入 bundle 会拖进整棵 RN 组件树）；
 * - `buildTokenInsertion` —— `@/components/chat/composer-token-insert`。
 *
 * 打开判据与现网一致：`activeAt != null && !inputDisabled`（`$` 侧同式），
 * 且候选为空时浮层不渲染（RN 侧 `open && candidates.length > 0` 口径）。
 *
 * es2018 纪律：禁 ES2021+ 运行时 API 与 lookbehind 正则。
 */
import {
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  type AtPathRef,
} from '@novel-master/core/chat';
import {filterSkillTypeaheadCandidates} from '@/components/chat/skill-typeahead-filter';
import type {EffectiveSkill} from '@novel-master/core/skills';
import type {ConversationTypeaheadSource} from './model';

export type {AtPathRef, EffectiveSkill};

/** 候选条数上限（现网两个 typeahead 都是 5）。 */
export const TYPEAHEAD_LIMIT = 5;

/** 浮层一行：展示 label + 点选后插入正文的 token。 */
export type TypeaheadItem = {
  readonly label: string;
  readonly token: string;
  /** 技能行右侧的来源 tag（`$` 侧专有；`@` 侧为空串）。 */
  readonly tag: string;
};

/** 浮层视图：`@` 路径与 `$` 技能两形态合成一份（谁开着返回谁）。 */
export type TypeaheadView =
  | {
      readonly trigger: '@';
      readonly query: string;
      readonly start: number;
      readonly items: readonly TypeaheadItem[];
    }
  | {
      readonly trigger: '$';
      readonly query: string;
      readonly start: number;
      readonly items: readonly TypeaheadItem[];
    };

/** 技能行右侧 tag 文案（逐字对齐 `SkillTypeahead.tsx` 的现网口径）。 */
export function skillTypeaheadTag(skill: EffectiveSkill): string {
  if (skill.disabled) {
    return '已关闭';
  }
  if (skill.domain === 'global') {
    return '全局';
  }
  return skill.overridden ? '项目 · 覆盖全局' : '项目';
}

/** `@` 候选行 label（目录带 📁 与尾斜杠，文件带 📄）。 */
export function atTypeaheadItem(ref: AtPathRef): TypeaheadItem {
  const isDir = ref.kind === 'dir';
  return {
    label: isDir ? `📁${ref.path}/` : `📄${ref.path}`,
    token: formatComposerAtPathToken(ref.path, isDir),
    tag: '',
  };
}

/** `$` 候选行 label（`$ 技能名` + 来源 tag）。 */
export function skillTypeaheadItem(skill: EffectiveSkill): TypeaheadItem {
  return {
    label: `$ ${skill.name}`,
    token: `$${skill.name}`,
    tag: skillTypeaheadTag(skill),
  };
}

/**
 * typeahead 视图计算（纯函数，node 环境直测）。
 *
 * @param text        输入框当前全文
 * @param cursor      光标位置（textarea.selectionStart）
 * @param source      RN 下发的候选源
 * @param enabled     `!inputDisabled`——禁用时恒不展开（现网 `open` 口径）
 * @returns 展开中的浮层；无活跃 token / 候选为空 / 禁用时返回 null
 */
export function computeTypeaheadView(
  text: string,
  cursor: number,
  source: ConversationTypeaheadSource,
  enabled: boolean,
): TypeaheadView | null {
  if (!enabled) {
    return null;
  }
  const at = findActiveAtQuery(text, cursor, '@');
  if (at != null) {
    // 封顶只做一次：`filterAtPathTypeaheadCandidates` 内部 `out.length >= limit`
    // 早停，返回值本就不超过 limit，外层再 slice 恒等（已由 cr1-P2-4 删掉）。
    const items = filterAtPathTypeaheadCandidates(
      source.files,
      at.query,
      TYPEAHEAD_LIMIT,
    ).map(atTypeaheadItem);
    return items.length > 0
      ? {trigger: '@', query: at.query, start: at.start, items}
      : null;
  }
  const skill = findActiveAtQuery(text, cursor, '$');
  if (skill != null) {
    const items = filterSkillTypeaheadCandidates(
      source.skills,
      skill.query,
      TYPEAHEAD_LIMIT,
    ).map(skillTypeaheadItem);
    return items.length > 0
      ? {trigger: '$', query: skill.query, start: skill.start, items}
      : null;
  }
  return null;
}
