/**
 * 错误域段表（错误通道迁移三期 spec-3 §3.7）。
 *
 * 域是 6 位码的前三位（DDDSSS，见 error-codes.ts 头注），码表登记时就定死。
 * 判域一律走 errors/guards.ts 的 `domainOf` / `inDomain`——唯一实现，不依赖
 * key 的命名约定：key 改名或新增前缀时 `startsWith` 判域会静默漏判（只走兜底、
 * 不报错），段号不会。段表 {@link DOMAIN_RANGES} 全仓仅此一份（此前只在
 * test/errors/app-error.test.ts），测试引用这里，不再自留副本。
 *
 * @module errors/domain
 */

/** 各域保留号段（闭区间）；新增域先在这里登记，test/errors/app-error.test.ts 强制 code 落段。 */
export const DOMAIN_RANGES = {
  AGENT: [101000, 101999],
  VFS: [102000, 102999],
  VFS_CHARACTER_CARD: [103000, 103999],
  TOOL: [104000, 104999],
  PROVIDER: [105000, 105999],
  CHAT: [106000, 106999],
  SKILL: [107000, 107999],
  COMPACTION_CONDITIONS: [108000, 108499],
  SMART_SORT_RULE: [108500, 108999],
  CONFIG: [109000, 109499],
  PREFERENCES: [109500, 109999],
  INFRA: [110000, 110999],
  DEPTH: [111000, 111999],
  EVENTS: [112000, 112999],
  FEATURE_FLAGS: [113000, 113999],
  FORMAT: [114000, 114999],
  KKV: [115000, 115999],
  SESSION_FS: [116000, 116999],
  PROMPT: [117000, 117999],
  SESSION_KKV: [118000, 118999],
  SESSION_RUN_STATE: [119000, 119999],
  USAGE: [120000, 120999],
  WORKPLACE: [121000, 121999],
  CLOUD_SYNC: [122000, 122999],
  IPC: [123000, 123999],
} as const satisfies Record<string, readonly [number, number]>;

/** 错误域：号段表的键名。 */
export type ErrorDomain = keyof typeof DOMAIN_RANGES;
