package com.novelmaster.tokenizer

import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.nio.file.Paths

/**
 * JVM unit test: claude HF JSON from main assets encodes a fixed prompt to > 0 tokens.
 * (Validates DJL + ST web conversion without a device.)
 */
class TokenizerEngineTest {
  @Test
  fun claudeFamilyCountsFixedStringAboveZero() {
    val asset =
      File("src/main/assets/tokenizers/claude.json").let { file ->
        if (file.exists()) file else File("app/src/main/assets/tokenizers/claude.json")
      }
    assumeTrue("claude.json asset missing", asset.exists())

    val tokenizer = HuggingFaceTokenizer.newInstance(Paths.get(asset.absolutePath))
    val serialized = "Hello from Novel Master tokenizer test."
    val count =
      WebPromptConverter.countWebSerialized(serialized) { text ->
        tokenizer.encode(text).ids.size
      }
    assertTrue("expected positive token count for claude web path", count > 0)
  }
}
