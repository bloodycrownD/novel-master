# Tokenizer assets (Node NMTP driver)

Canonical tokenizer model files for `@novel-master/tokenizer-driver-node`.

- Loaded by `registerTokenizerNodeDriver()` via `NodeTokenizerLoader`.
- Android RN uses a separate copy under `packages/tokenizer-driver-rn/android/src/main/assets/tokenizers/`.
- Do not duplicate under `apps/cli/` or `apps/mobile/` — those paths were removed in the NMTP migration.
