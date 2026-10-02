/**
 * Agent Prompt 布局域形态归一化（strip 旧 worktree 块、保留 workplace string）。
 *
 * @module domain/prompt/logic/normalize-agent-prompt-layout
 */

import type {
  AgentPromptLayout,
  PersistTextPromptBlock,
} from "../model/agent-prompt-layout.js";
import {
  layoutHasCustomAttach,
  layoutHasWorkplace,
} from "../model/agent-prompt-layout.js";

/** wire / 域对象中的旧 worktree 块形状（读入时 strip，不写入域模型）。 */
export type LegacyPersistWorktreeWireBlock = {
  readonly name: string;
  readonly type: "worktree";
  readonly role?: "user" | "assistant";
};

/** 是否为旧 persist worktree 块（读入 strip，不升迁 workplace）。 */
export function isLegacyWorktreeWireBlock(
  block: unknown
): block is LegacyPersistWorktreeWireBlock {
  return (
    block != null &&
    typeof block === "object" &&
    !Array.isArray(block) &&
    (block as { type?: unknown }).type === "worktree"
  );
}

/**
 * 从 wire persist map 丢弃 `type:worktree` 条目（**不**据此设 workplace）。
 */
export function stripLegacyWorktreeBlocksFromPersistMap(
  persist: Record<string, unknown>
): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [name, item] of Object.entries(persist)) {
    if (isLegacyWorktreeWireBlock(item)) {
      continue;
    }
    filtered[name] = item;
  }
  return filtered;
}

/**
 * normalize 覆盖的**可选字段全集**（`persist` / `dynamic` 两个必填数组除外）。
 *
 * 本常量是「白名单完整性」的唯一事实源（wave-e H2 Step 1）。双向锁：
 * - 给 {@link AgentPromptLayout} 新增可选字段而忘了加进这里 ⇒ `Record` 缺键 ⇒ **编译红**；
 * - 往这里加一个模型上已不存在的字段 ⇒ excess property ⇒ **编译红**。
 *
 * 之所以要这道锁：`normalizeAgentPromptLayoutDomain` 靠一串条件 spread 逐字段重建返回对象，
 * 漏一条 spread **既不编译报错也不测试红**，只是静默丢字段。该病已连续发作两次
 * （`customAttach`、后是 `skillsEnabled` / `skillsPrefix`），且 `skillsEnabled` 漏掉的后果
 * 不是少个字段而是**语义反转**——`false` 掉成 `undefined`，下游按「缺省 = 开」处理，
 * 用户关了技能能力却仍在注入。
 *
 * ⚠️ 值全写 `null`：本表只表达「键集合」，不表达取值；取值由 {@link NORMALIZE_FIELD_SENTINELS} 负责。
 */
export const NORMALIZED_OPTIONAL_FIELDS = {
  system: null,
  persistEnabled: null,
  dynamicEnabled: null,
  workplace: null,
  customAttach: null,
  skillsEnabled: null,
  skillsPrefix: null,
} satisfies Record<Exclude<keyof AgentPromptLayout, "persist" | "dynamic">, null>;

/** {@link NORMALIZED_OPTIONAL_FIELDS} 的键类型（编译期与上面那张表同源，不会漂移）。 */
export type NormalizedOptionalField = keyof typeof NORMALIZED_OPTIONAL_FIELDS;

/**
 * 每个可选字段的**非省略形态哨兵值**（wave-e H2 Step 2）。
 *
 * 哨兵逐个选在「normalize 必须保留」的那一侧：`persistEnabled` / `dynamicEnabled` 取 `true`
 * （缺省 = 关），`skillsEnabled` 取 **`false`**（缺省 = 开、仅显式 false 才是关），
 * 其余字符串字段取非空且 trim 后非空的值。
 * ⚠️ 两张表是**分开的**（一张只管键、一张只管值），所以测试里有一条断言专查它们键集是否一致。
 */
export const NORMALIZE_FIELD_SENTINELS = {
  system: "__sentinel__system",
  persistEnabled: true,
  dynamicEnabled: true,
  workplace: "__sentinel__workplace",
  customAttach: "__sentinel__customAttach",
  skillsEnabled: false,
  skillsPrefix: "__sentinel__skillsPrefix",
} satisfies Record<
  NormalizedOptionalField,
  Exclude<AgentPromptLayout[NormalizedOptionalField], undefined>
>;

/**
 * 运行期穷举断言：normalize 是否逐字段保值（wave-e H2 Step 2）。
 *
 * **为什么不按「与实际 spread 集合对账」的字面写法实现**：运行期导不出「实际 spread 集合」，
 * 把同一份键表再抄一遍进断言体会让断言恒真——删任一 spread 也不红，正撞牙齿判据①的事故原型。
 * 故改用**哨兵值驱动**：逐键塞入 {@link NORMALIZE_FIELD_SENTINELS}，跑 normalize，断言哨兵被原样回吐。
 * ⇒ 删任一 spread ⇒ 该字段的哨兵回不来 ⇒ 抛错；
 * ⇒ 新增第 8 个字段只要进了 {@link NORMALIZED_OPTIONAL_FIELDS} 与哨兵表，就自动进入断言面，**不必改测试**。
 *
 * 供测试与生产双用；失败即抛 `Error`（不 exit），由调用方决定怎么报。
 */
export function assertNormalizeCoversAllFields(): void {
  const normalized = normalizeAgentPromptLayoutDomain({
    ...NORMALIZE_FIELD_SENTINELS,
    persist: [],
    dynamic: [],
  });
  const missed: NormalizedOptionalField[] = [];
  for (const field of Object.keys(
    NORMALIZED_OPTIONAL_FIELDS,
  ) as NormalizedOptionalField[]) {
    // ⚠️ 用 !== 而非 in：某字段被「写了但值不对」（如 skillsEnabled 写成 === true）同样要红。
    if (normalized[field] !== NORMALIZE_FIELD_SENTINELS[field]) {
      missed.push(field);
    }
  }
  if (missed.length > 0) {
    throw new Error(
      `[normalizeAgentPromptLayoutDomain] 白名单漏字段：${missed.join("、")}。` +
        `NORMALIZED_OPTIONAL_FIELDS 声明了这些字段，但 normalize 没有原样回吐哨兵值 —— ` +
        `多半是对应的条件 spread 被删了，或分支条件写反（如 skillsEnabled 写成 === true）。`,
    );
  }
}

/**
 * 域 layout 归一化：persist 仅 text；保留非空 `workplace` string（勿压成 boolean）；丢弃旧 worktree 块。
 *
 * ⚠️ 本函数的返回对象由**显式白名单逐字段重建**，因此白名单必须覆盖
 * {@link AgentPromptLayout} 的全部可选标量字段（`persist` / `dynamic` 两个必填数组除外）。
 * 新增字段时必须同步：① 本白名单；② `test/prompt/normalize-agent-prompt-layout.test.ts`
 * 的「全字段白名单往返」用例夹具；③ 本文件下方 {@link NORMALIZED_OPTIONAL_FIELDS} 的
 * 编译期穷举守卫与 {@link assertNormalizeCoversAllFields} 的运行期断言
 * （wave-e H2 Step 1/Step 2）。前两者漏了就静默丢字段，三者缺一不可。
 * ⚠️ 各字段的省略语义**不统一**，勿照抄邻居：
 * `persistEnabled` / `dynamicEnabled` 用 `=== true`（缺省 = 关），
 * 而 `skillsEnabled` 用 `=== false`（缺省 = 开，仅显式 false 表示关闭，
 * 见 `agent-definition.schema.ts`）——写成 `=== true` 会把用户已关闭的技能能力过滤掉。
 */
export function normalizeAgentPromptLayoutDomain(
  layout: AgentPromptLayout
): AgentPromptLayout {
  const persist = layout.persist.filter(
    (block): block is PersistTextPromptBlock =>
      (block as { type?: string }).type === "text"
  );
  return {
    ...(layout.system != null && layout.system.trim() !== ""
      ? { system: layout.system }
      : {}),
    ...(layout.persistEnabled === true ? { persistEnabled: true } : {}),
    ...(layout.dynamicEnabled === true ? { dynamicEnabled: true } : {}),
    ...(layoutHasWorkplace(layout) ? { workplace: layout.workplace } : {}),
    ...(layoutHasCustomAttach(layout)
      ? { customAttach: layout.customAttach }
      : {}),
    ...(layout.skillsEnabled === false ? { skillsEnabled: false } : {}),
    // 与 validateAgentPromptLayoutFromMaps 逐字对齐：`skillsEnabled` 是「缺省 = 开」。
    ...(() => {
      const prefixRaw = layout.skillsPrefix;
      return typeof prefixRaw === "string" && prefixRaw.trim().length > 0
        ? { skillsPrefix: prefixRaw }
        : {};
    })(),
    persist,
    dynamic: [...layout.dynamic],
  };
}
