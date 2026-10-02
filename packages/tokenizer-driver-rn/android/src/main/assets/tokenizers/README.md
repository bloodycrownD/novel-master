# Tokenizer assets (Android NMTP driver)

Canonical tokenizer model files for Kotlin `TokenizerEngine` (WEB/SP families + tiktoken).

- Node/CLI uses `packages/tokenizer-driver-node/assets/tokenizers/` instead.
- RN JS does not read this directory; only the native module loads these files.
- **与 node 侧有意分叉（token-count-perf-r2）**：`cl100k.json` / `o200k.json` 只在本
  目录（Android 原生 gpt 计数用），node/desktop 的 gpt 计数走 WASM tiktoken 不读
  assets——请勿「顺手同步」到 node 侧（+9MB 死重量进安装包）。

## 文件清单与来源

| 文件 | 家族/编码 | 来源 | 说明 |
|---|---|---|---|
| claude.json 等 13 份 | WEB/SP 家族 | SillyTavern / SillyTavern-Tokenizers（见 LICENSE.md） | 历史资产，与 node 侧字节级一致 |
| cl100k.json | tiktoken / cl100k_base | HF `Xenova/gpt-4` `tokenizer.json` @ `1d9f1f1b1fae88c0e4df1dab0a397f8de6229075`（2026-10-03 获取） | 紧凑化（3.9→2.6MB，入库实测 2,730,931B）；无 post_processor/normalizer，直编码不注特殊 token |
| o200k.json | tiktoken / o200k_base | HF `Xenova/gpt-4o` `tokenizer.json` @ `7956d98f2a83b2751a98ea7136fdf7fe6cf54e69`（2026-10-03 获取） | 紧凑化（8.1→6.4MB，入库实测 6,730,442B）；同上 |

tiktoken 两表的计数一致性由 `TokenizerParityTest` 对拍门锁定（js-tiktoken 裸
encode 同值域，容差 max(3, 0.5%)）；词表换版走「长度比对失效」既有机制
（`copyAssetToCache`），换版时更新本表来源列——**commit hash 是换版比对的锚点**
（同名不同 commit 的转换件可能同长度，长度比对拦不住，靠本表人工核对）。

运行时缓存名（cacheDir）：`nm_tok_tokenizers_cl100k.json` /
`nm_tok_tokenizers_o200k.json`。
