package com.novelmaster.tokenizer

/**
 * Kotlin tokenizer constants kept in sync with core TypeScript.
 *
 * Source of truth: `packages/core/src/infra/tokenizer/impl/heuristic-token-counter.ts`
 * (`CHARACTERS_PER_TOKEN_RATIO`). Kotlin cannot import JS; update both when the ratio changes.
 */
object TokenizerConstants {
  /** SillyTavern heuristic fallback — must match core `CHARACTERS_PER_TOKEN_RATIO`. */
  const val CHARACTERS_PER_TOKEN_RATIO = 3.35
}
