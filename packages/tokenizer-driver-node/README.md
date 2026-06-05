# @novel-master/tokenizer-driver-node

Node.js NMTP (Novel Master Tokenizer Protocol) driver — precise token counting for CLI and core tests.

## Role

Core exposes `countPromptLlmInput()` and a heuristic-only registry. This package registers the **Node** driver so WEB/SP/tiktoken families resolve via `@agnai/*` and `tiktoken`, reading tokenizer assets from `assets/tokenizers/`.

## Setup

```typescript
import { registerTokenizerNodeDriver } from "@novel-master/tokenizer-driver-node";

registerTokenizerNodeDriver(); // optional { assetsRoot } for custom asset dir
```

Call once at process startup (CLI `runtime.ts` does this alongside TDBC/SKSP registration).

## Test helper

Driver-package tests use `registerTokenizerNodeDriverForTests()`. Core tests should use `packages/core/test/helpers/register-node-tokenizer-driver-for-tests.ts` (relative imports, no tsconfig path hacks).

## Constants

`CHARACTERS_PER_TOKEN_RATIO` (3.35) is defined in `@novel-master/core` (`heuristic-token-counter.ts`). This driver imports it from core; do not duplicate.
