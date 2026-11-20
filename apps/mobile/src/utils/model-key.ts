/**
 * 服务商 × 模型组合键（mobile 单源）。
 *
 * 两个键用途不同、分隔符不同，不能互相替换：
 * - `name`：模型列表内的同名计数键（NUL 分隔，模型名里带 `::` 也不会撞键）；
 * - `providerModel`：数据统计筛选项 / 列表行 key（`::` 分隔，与选项 id 同源，
 *   `MODEL_OTHER_KEY` 直接拼在其后）。
 */
export const ModelKey = {
  /** 同名计数键（只在同一列表内两两比较，不对外展示）。 */
  name: (providerId: string, modelName: string): string => `${providerId}\0${modelName}`,
  /** 统计筛选项 / 列表行 key（`{providerId}::{model}`，`model` 可为 `__other__`）。 */
  providerModel: (providerId: string, model: string): string => `${providerId}::${model}`,
} as const;
