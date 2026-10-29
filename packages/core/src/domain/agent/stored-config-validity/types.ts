/**
 * 存储配置有效性判定类型。
 *
 * @module domain/agent/stored-config-validity/types
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
