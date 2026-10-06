/**
 * typeahead 视图计算的 RN 侧新址（composer-native-2026-10 Step 4 · D5 候选纯函数迁移）。
 *
 * **来历**：逻辑原样迁自 `src/web/chat-conversation/webview/typeahead.ts` 的
 * `computeTypeaheadView`（chat-webview-unify 期随 dock WebView 化搬进 web 的那版，
 * 再往前是 legacy RN `ChatComposer` 的手输 typeahead）。迁移纪律是**逐字保真**：
 * 触发判定复用 core 的 `findActiveAtQuery`（触发符前须空白/行首、query 含空白
 * 终止）、过滤复用 `filterAtPathTypeaheadCandidates` / `filterSkillTypeaheadCandidates`、
 * 上限 5——迁到 RN 不引入第二套口径，行为差异由迁移保真测试守住。
 *
 * web 侧原文件在 Step 6（chat-conversation 包退役）时随包删除；退役前它与本
 * 文件短暂并存，不建 import 依赖（web bundle 不引 RN 模块），以测试对账。
 */

import type {EffectiveSkill} from '@novel-master/core/skills';
import {
  filterAtPathTypeaheadCandidates,
  findActiveAtQuery,
  formatComposerAtPathToken,
  type AtPathRef,
} from '../composer-at-path';
import {filterSkillTypeaheadCandidates} from '../skill-typeahead-filter';
import type {ConversationTypeaheadSource} from '../ChatConversationBridge';

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
 * @param cursor      光标位置（输入组件的选区起点）
 * @param source      RN 侧下发的候选源
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

/**
 * 浮层渲染的幂等键：`trigger | start | 候选 token 串`（web dock 的
 * `typeaheadRenderKey` 同款语义）。
 *
 * web 侧用它在 innerHTML 之前拦掉「候选没变的重渲」；RN 侧 React 自带 diff，
 * 键的消费点是浮层容器的 React `key`——键变（换 token 集/换触发形态/收起）才
 * 重挂浮层，键同（随手光标、无候选变化的选区抖动）则复用既有挂载。
 */
export function typeaheadRenderKey(view: TypeaheadView | null): string {
  if (view == null) {
    return 'none';
  }
  return `${view.trigger}|${view.start}|${view.items
    .map(item => item.token)
    .join('\u0001')}`;
}
