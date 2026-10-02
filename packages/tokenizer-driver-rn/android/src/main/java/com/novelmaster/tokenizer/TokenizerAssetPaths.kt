package com.novelmaster.tokenizer

/** Asset paths under `assets/tokenizers/` — mirrors core `tokenizerAssetPaths`. */
internal data class AssetPathSpec(
  val primary: String,
  val fallback: String? = null,
  val kind: String,
)

internal object TokenizerAssetPaths {
  fun forFamily(family: String): AssetPathSpec? {
    return when (family) {
      "claude" -> AssetPathSpec("claude.json", kind = "json")
      "llama3" -> AssetPathSpec("llama3.json", kind = "json")
      "llama" -> AssetPathSpec("llama.model", kind = "model")
      "mistral" -> AssetPathSpec("mistral.model", kind = "model")
      "yi" -> AssetPathSpec("yi.model", kind = "model")
      "gemma" -> AssetPathSpec("gemma.model", kind = "model")
      "jamba" -> AssetPathSpec("jamba.model", kind = "model")
      "qwen2" -> AssetPathSpec("web/qwen2.json", "llama3.json", "json")
      "command-r" -> AssetPathSpec("web/command-r.json", "llama3.json", "json")
      "command-a" -> AssetPathSpec("web/command-a.json", "llama3.json", "json")
      "nemo" -> AssetPathSpec("web/nemo.json", "llama3.json", "json")
      "deepseek" -> AssetPathSpec("web/deepseek.json", "llama3.json", "json")
      "glm" -> AssetPathSpec("web/glm.json", "llama3.json", "json")
      else -> null
    }
  }

  /**
   * gpt 家族（family == "tiktoken"）按**编码名**选词表（token-count-perf-r2）。
   * 编码名由 JS 侧 `resolveRnEncodingName` 解析后经 `vendorModelId` 槽下发；
   * 两表均为 HF tokenizer.json 转换版（来源 manifest 见 assets/tokenizers/README.md），
   * 无 post_processor / normalizer——直编码不注入特殊 token，与 tiktoken 裸
   * encode 行为对齐。未知编码名返回 null（Engine 抛异常 → JS 回退 js-tiktoken）。
   */
  fun forTiktokenEncoding(encodingName: String): AssetPathSpec? {
    return when (encodingName) {
      "cl100k_base" -> AssetPathSpec("cl100k.json", kind = "json")
      "o200k_base" -> AssetPathSpec("o200k.json", kind = "json")
      else -> null
    }
  }
}
