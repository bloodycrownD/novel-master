/**
 * Desktop renderer 对 core 编码表注册中心的具名薄再导出（X1 门禁）。
 * 禁止 `export *`。
 *
 * X1：renderer 严禁直连 `@novel-master/core`（eslint 把关），core 的入口
 * 一律经 `@shared/logic/*` 再导出（先例 `format.ts`）。编码表单例
 * （fallback-caliber-align A/B 线）已收敛进 core 的 `encoding-registry`：
 * `getEncoding` 本身零分词器依赖，构造器由调用方注入——renderer 进程注入
 * js-tiktoken 构造的消费现场见 `renderer/hooks/stream-token-estimator.ts`。
 */

export {
  getEncoding,
  type EncodingHandle,
} from "@novel-master/core/provider";
