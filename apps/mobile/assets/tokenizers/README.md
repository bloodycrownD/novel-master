# Tokenizer assets (mobile tree)

This directory is **not** bundled into the React Native Metro JS bundle. Production Android loads model files from `android/app/src/main/assets/tokenizers/` via `NovelMasterTokenizer`.

| Location | Purpose |
|----------|---------|
| `apps/mobile/android/app/src/main/assets/tokenizers/` | Android native tokenizer (runtime) |
| `apps/cli/assets/tokenizers/` | CLI `install-node-tokenizer-loader` |
| `apps/mobile/assets/tokenizers/` (here) | Documentation and **Node/core tests** that read files via `installNodeTestTokenizerLoader` |

When updating tokenizer files, keep CLI and Android copies in sync per the android-native-tokenizer-bridge spec. Do not add `require()` of this path from `apps/mobile/src`.
