---
date: 2026-08-28
title: markdown-code-block-render CR 第 1 轮 must-fix 修复（MF-1/MF-2 双 P2 闭合）
keywords: markdown-code-block-render, CR fix-spec, MF-1, MF-2, hljs 内置别名, mjs, cjs, escapeHtml, rawLang 转义, decodeAfterSanitize, T-CB13
abstract: CR-R1 fix-spec 两条 P2 闭合。MF-1 按方案 b（用户拍板并数双端统一化）：mobile resolveHighlight 门控从「仅 LANG_ALIAS 表」放宽为「归一化表优先、表外回退 hljs 注册表」，与 desktop rehype-highlight 落在同一 hljs 注册表同一判定逻辑——mjs/cjs 等模块内置别名双端均高亮但不出 data-lang，rust 等未命中双端均纯文本；spec「语言清单与归一化」节回写 deviation 与双端注册机制差异说明；统一样例（spec + 双端测试三处同文）补 ```mjs 块；T-CB13 双端各补 mjs/cjs 行为断言。MF-2：rawLang 拼接 class 前过 markdown.utils.escapeHtml，消除「表 key 恒字母数字」不变式的隐式依赖；测试两层锁定（mock 透传锁定拼接路径无裸尖括号反射 / 真实 sanitize 管道锁定默认 fence 路径无注入向量）。验收过程新发现既有管道组合行为记 OQ6：fence 首词为 x"onmouseover="alert(1)（无空格引号拼接）时 markdown-it 默认 fence 不转义引号、sanitize-html 将整串视为 class 值、出口 decodeAfterSanitize 按既有设计回解 &quot;，最终 HTML 仍含事件属性拼接形态——修复前即存在、超出本轮范围。提交 ae7c948（MF-1）+ 81ba492（MF-2）。
---

user:
（worktree .woktree/markdown-code-block-render，分支 feat/markdown-code-block-render）修复 markdown-code-block-render 迭代 CR 待修项，先通读 docs/Iterations/markdown-code-block-render/cr-fix-spec.md。已知 2×P2：1) MF-1 hljs 内置语言别名 mjs/cjs 双端分叉，原待拍板 a/b 已按推荐方案 b 执行（spec 回写 deviation + 双端统一用 hljs 内置别名行为并统一样例 + mjs 样例锁定双端一致，具体以 fix-spec 为准）；2) MF-2 rawLang 未转义可能注入特殊字符需转义。环境：首次跑测试先 npm run build -w @novel-master/core -w @novel-master/tdbc-driver-better-sqlite3；desktop typecheck 用 npm run typecheck，mobile 用 npx tsc --noEmit -p tsconfig.build.json；双端行为必须一致（别名判定同一逻辑）补 mjs/cjs 样例测试；rawLang 转义补测试含 < > & "；修完 fix-spec 标注闭合；方案 b 需同步 spec deviation；按逻辑块提交中文 commit。

assistant:
两条 P2 全部闭合，按逻辑块提交两次（ae7c948 MF-1、81ba492 MF-2），双端 typecheck 与相关测试全绿。
- 实证先行：用临时 tsx 脚本确认 desktop rehype-highlight 对 ```mjs 输出 <pre><code class="language-mjs"> + 高亮 span、无 data-lang（renderCodeBlock 剥壳后 class 保留原文）；hljs core 注册后 getLanguage('mjs'/'cjs') 命中 JavaScript、mts/cts 命中 TypeScript——mobile 门控可对齐同一注册表。
- MF-1 实现只动 mobile：highlight-code.ts 增 lookupRegisteredLang（表外回退 hljs.getLanguage 小写查表），prepare-transcript-rich-html.ts 把「if (normalized) 才高亮」改为 resolveHighlight 统一判定、data-lang 仅归一化表命中输出。desktop 零代码改动（现状即目标行为），靠测试锁定。
- MF-2 关键管道事实：escapeHtml 的 &quot;/&amp; 会被出口 decodeAfterSanitize 按既有设计回解（该函数只解 quot/amp，lt/gt 存活）——所以端到端断言只能锁定「无裸 < > 反射」，引号转义在最终 HTML 不可见；mock 透传 sanitize 的测试环境用于锁定拼接路径转义生效。
- 双端壳类差异不影响视觉：desktop 对表外别名块剥 hljs 壳类（renderCodeBlock 降级路径），mobile 保留 hljs 壳类——两端 CSS 均无 .hljs 壳类规则（只有 token 色值），token 色一致即视觉一致；T-CB13 契约（data-lang 集合 + hljs-* token 并集）双端通过。
- 环境坑：edit_file 写含 \n 的测试字符串时 JSON 转义层级易错（\n 成真实换行 → babel unterminated string），需写 \\n；worktree 内 grep/find_path 工具对 .woktree 隐藏目录的 include_pattern 失效，用终端 grep 替代。
