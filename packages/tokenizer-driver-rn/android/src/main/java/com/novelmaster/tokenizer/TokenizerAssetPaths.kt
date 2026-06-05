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
      else -> null
    }
  }
}
