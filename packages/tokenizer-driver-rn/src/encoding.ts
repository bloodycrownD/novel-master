/**
 * RN 编码表单例子入口（Metro / Metro 免 RN 运行时依赖的纯逻辑侧）。
 *
 * 单独开一个子路径而不是并进主入口：主入口会连带拉进 `android-native-bridge`
 * → `react-native`，而 app 侧只想复用「按编码名单例 + 真分词器计数」这部分纯
 * 逻辑（`stream-token-estimator` / `chat-prompt-tokens`），不该为此把 RN 运行时
 * 和原生模块拖进服务层与它们的单测。
 *
 * @module tokenizer-driver-rn/encoding
 */

export {
  getRnEncoding,
  getDefaultRnEncoding,
  countTextWithDefaultEncoding,
  DEFAULT_RN_ENCODING_NAME,
  type RnEncodingName,
  type RnTokenEncoding,
} from "./impl/encoding-cache.js";
export {
  __resetRnEncodingCacheForTests,
  __setRnEncodingFactoryForTests,
} from "./impl/encoding-cache.js";
