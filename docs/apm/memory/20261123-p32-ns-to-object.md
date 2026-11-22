# p32 namespace 语法块残留收口（2026-11-23）

用户发起：不少残留 namespace 使用，应该用类或 Object namespace 替换。盘点全仓 `export namespace X {}` 语法块 **192 处**（mobile 132 / core 11 / desktop handlers+services 15 / drivers 7 / block-split 1，零 ambient）。

## 范围裁决（中途翻转）
初版全量 192 处 codemod——apps/drivers 层连锁灾难后收窄为 **core 11 文件**（809bfa732，tag p32-ns-to-object）；apps/drivers **永久豁免保持 namespace**。理由：mobile 132 个 UI helper namespace 的转换引发 `X.TypeName` 类型访问断裂（const 无类型成员）+ 巨量调用点连锁，修复成本远超收益。

## 三轮 codemod 教训（全部实测翻车）
1. **regex 行级 + 双 pass（转换→上提）**：pass2 的 `export const X = {` 识别符是全仓通用形态 → 误伤 592 个原生 object → 回滚。
2. **regex 行级单 pass**：4 空格缩进假设打碎 2 空格漏网文件（duckduckgo/parser.ts/tokenizer-loader）；互调前缀的定义行恢复漏 async 形态与同行多调用（col 偏移）；tsc 驱动循环 checkout 把类型连锁红也撤 → 150 文件雪崩。**循环 checkout 只许撤 TS1xxx 语法错，TS2xxx 是连锁信号绝不能撤**。
3. **AST 级 v2**：`st.getStart()` 不含 leading trivia → **全部 JSDoc 注释丢失**（资产级损失，靠 keep 指令失效才暴露）。
4. **v3 终版**（`D:/tmp/ns2obj-v3.mjs`）：getFullStart 切片保注释、成员分类（function→method shorthand / const·type·interface·enum 上提）、成员间补逗号、每文件转换后**即时 parse 验证**（parseDiagnostics>0 即回滚该文件）；互调前缀用 tsc 错误清单驱动（TS2304 精确行号列号、同行按列降序处理）。
5. **误伤回滚要 `git restore --staged --worktree`**——`git checkout -- path` 从 index 恢复，index 被中途 git add 污染时恢复的是坏版本。

## 形态与豁免判据
- namespace→object 转换五件套：头尾转换、成员剥前缀（method shorthand，零 TSX 泛型歧义）、const/type 上提（对象字面量不能有语句/类型成员）、互调加 `X.` 前缀、**成员间补逗号**（namespace function 间不需要逗号是最大陷阱）。
- 豁免（保持 namespace）：apps 层 UI helper、2 空格/缩进混乱文件（block-split.ts、tokenizer-loader 等）、平台契约形态。
- hygiene 阻断矩阵：exported INLINE_CANDIDATE 在 changed/all/strict 模式**阻断**；keepRescue 认 keep-public/keep-local 指令（注释在 method 上方即可豁免为 KEEP_PUBLIC）。

## 验收终态
core tsc 0、core 960/0、typecheck 15/15、desktop 774/0、mobile 2384/2384、nm-style PASS（signatures=0、dup -2 组）、dist 完整重建、净删 91 行（108+/199-）。
