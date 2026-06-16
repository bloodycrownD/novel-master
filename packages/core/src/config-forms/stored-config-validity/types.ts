/**
 * 存储配置有效性判定类型与版本常量。
 *
 * @module config-forms/stored-config-validity/types
 */

/** 失效原因分类（用户可见文案由 labels 映射）。 */
export type StoredConfigInvalidCode =
  | "outdated_version"
  | "broken_wire"
  | "removed_feature";

/** 存储 wire 有效性判定结果。 */
export type StoredConfigHealth<T> =
  | { readonly status: "valid"; readonly value: T }
  | {
      readonly status: "invalid";
      readonly code: StoredConfigInvalidCode;
      /** 技术细节，次要展示 */
      readonly message: string;
      readonly storedSchemaVersion?: number;
    };

/** 当前事件配置 wire schema 版本。 */
export const CURRENT_EVENTS_SCHEMA_VERSION = 2 as const;

/** 当前智能体配置 wire schema 版本。 */
export const CURRENT_AGENT_SCHEMA_VERSION = 1 as const;
