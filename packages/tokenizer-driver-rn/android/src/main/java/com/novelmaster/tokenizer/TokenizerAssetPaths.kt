package com.novelmaster.tokenizer

/**
 * Asset paths under `assets/tokenizers/`。
 *
 * 与 core `tokenizerAssetPaths` 的**已知分叉**（sp-to-hf，2026-11-06）：llama /
 * mistral / gemma 在本端指向转换后的 `tokenizer.json`，core 侧仍指 `.model`——
 * Node 驱动有 `@agnai/sentencepiece-js`（WASM）能真跑 SP，Android 没有
 * SentencePiece native，只能借已有的 HF native 路径。tiktoken 两表
 * （cl100k/o200k）为本目录独有。
 */
internal data class AssetPathSpec(
  val primary: String,
  val fallback: String? = null,
  val kind: String,
  /**
   * true = 对整串裸编码、不做 WEB 家族的 system 包装（`WebPromptConverter` 会在
   * 尾部追加 `\n\nAssistant:` 等）。SP 家族转 HF 后必须裸编码才能与 Node 侧
   * `SentencePieceTokenCounter` 的口径对齐——同一份文本两者差 3~5 token。
   */
  val bare: Boolean = false,
)

internal object TokenizerAssetPaths {
  fun forFamily(family: String): AssetPathSpec? {
    return when (family) {
      "claude" -> AssetPathSpec("claude.json", kind = "json")
      "llama3" -> AssetPathSpec("llama3.json", kind = "json")
      // SP 家族转 HF（sp-to-hf，2026-11-06）：Android 没有 SentencePiece native
      // （DJL 无 ai.djl.android:sentencepiece-native），这些家族此前恒落 JS cl100k
      // 兜底。`.model` 用 transformers 的 convert_slow_tokenizer 转成 tokenizer.json
      // 后直接复用已有的 libdjl_tokenizer.so，脚本见
      // packages/tokenizer-driver-rn/scripts/convert-sp-to-hf.py。
      // `bare = true`：Node 侧 SP counter 是裸编码，这里走 HF 也必须裸编码，
      // 否则 WEB 包装（+`\n\nAssistant:`）会稳定多出 3~5 token。
      // yi / jamba 转换后偏差 ±1 token（normalizer 细节差异），暂留 model 档。
      "llama" -> AssetPathSpec("llama.json", kind = "json", bare = true)
      "mistral" -> AssetPathSpec("mistral.json", kind = "json", bare = true)
      "yi" -> AssetPathSpec("yi.model", kind = "model")
      "gemma" -> AssetPathSpec("gemma.json", kind = "json", bare = true)
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
      "cl100k_base" -> AssetPathSpec("cl100k.json", kind = "json", bare = true)
      "o200k_base" -> AssetPathSpec("o200k.json", kind = "json", bare = true)
      else -> null
    }
  }
}
