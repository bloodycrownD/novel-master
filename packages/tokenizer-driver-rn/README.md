# @novel-master/tokenizer-driver-rn

React Native NMTP driver — js-tiktoken (GPT) + Android native bridge (WEB/SP) + heuristic fallback.

## Entry points

| Import | Use when |
|--------|----------|
| `@novel-master/tokenizer-driver-rn` | Node/Jest tests, docs |
| `@novel-master/tokenizer-driver-rn/native` | **RN App / Metro** — register at startup (mirrors `tdbc-driver-rn/native`) |
| `@novel-master/tokenizer-driver-rn/android-native-bridge` | Low-level native module access |

## Setup (RN App)

```typescript
import { registerTokenizerRnDriver } from "@novel-master/tokenizer-driver-rn/native";

registerTokenizerRnDriver(); // e.g. in getMobileConnection() with TDBC/SKSP drivers
```

## Android native module

Kotlin lives under `android/src/main/java/com/novelmaster/tokenizer/`. `MainApplication.kt` explicitly `add(TokenizerPackage())` alongside autolink (same pattern as `@novel-master/sksp-android`).

Tokenizer model files: `android/src/main/assets/tokenizers/`.

## Constants

`CHARACTERS_PER_TOKEN_RATIO` (3.35) source of truth is core TypeScript:

`packages/core/src/infra/tokenizer/impl/heuristic-token-counter.ts`

Kotlin mirrors it in `TokenizerConstants.kt` (cannot import JS). Update both when the ratio changes.

## Parity goldens

Regenerate JVM test goldens after tokenizer or counting changes:

```bash
npm run build -w @novel-master/core -w @novel-master/tokenizer-driver-node
node packages/tokenizer-driver-rn/scripts/generate-tokenizer-parity-goldens.mjs
```
