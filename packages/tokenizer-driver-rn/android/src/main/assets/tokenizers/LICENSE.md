# Tokenizer assets

Vendored from [SillyTavern](https://github.com/SillyTavern/SillyTavern) `src/tokenizers/` and
[SillyTavern-Tokenizers](https://github.com/SillyTavern/SillyTavern-Tokenizers) (web JSON fallbacks).

Use follows the upstream SillyTavern project license terms.

## tiktoken 转换件（token-count-perf-r2）

`cl100k.json` / `o200k.json` 来自 Hugging Face 社区转换仓库（`Xenova/gpt-4`、
`Xenova/gpt-4o` 的 `tokenizer.json`），其词表数据源自 OpenAI 官方 tiktoken
发布的 cl100k_base / o200k_base 编码。使用遵循各上游（转换仓库与 OpenAI
tiktoken）的许可条款；本仓仅作本地计数用途的分发，不修改词表内容（仅
JSON 紧凑化，键值逐字节等价）。
