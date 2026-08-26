---
date: 2026-08-26
title: markdown-code-block-render PRD/SPEC 第 1 轮审查修复（No-Go，3 P0 + 1 P1 + 1 P2）
keywords: markdown-code-block-render, prd, spec, CR, rehype-highlight, lowlight, plainText, subset, fence renderer, RN 回退, RichContentBody
abstract: markdown-code-block-render 第 1 轮审查 No-Go，须闭合 3 条 P0 + 1 条 P1 + 1 条 P2。P0-1 rehype-highlight@7 的 subset 仅 detect 路径生效、ignoreMissing 非 v7 选项、插件先加 hljs 类再查语言致 mermaid 严格相等特判（MermaidMarkdown.tsx L415 `=== "language-mermaid"`）必失配——C-3 改 languages 显式注册 + plainText:['mermaid'] + detect:false，特判改 includes 宽匹配。P0-2 lowlight 缺省 common 集（37 语言含 rust）会高亮清单外语言且留空 hljs 类——renderCodeBlock 对归一化表外语言剥空 hljs 类，T-CB3 维持原断言；补双端注册表同源（10 模块，html→xml、shell→bash 别名承载）。P0-3 RichContentBody 已是纯文本回退（无 RenderHTML 树），classesStyles 方案无实现载体——PRD 需求 6/验收第 8 条/包含范围降级为「维持纯文本现状」，C-12/Step 9/T-CB12 改为行为不变回归断言。P1-1 用户气泡覆盖行号改 L5914-5922 并写明变量分工（pre 用 --surface-inset、code 用 --background）。P2-1 C-7 收敛为覆盖 fence renderer 单一出口，删挂 highlight 选项表述。仅改 prd.md 与 spec.md，未动实现代码。
---

user:
（非 readonly 模式修复文档，只改 PRD/SPEC 不改实现代码，可写 docs/Iterations/markdown-code-block-render/prd.md 与 spec.md）第 1 轮审查 No-Go，须闭合全部 P0+P1、P2 顺手修。must-fix：1) P0-1 rehype-highlight@7 subset 只在 detect 路径生效、ignoreMissing 非 v7 选项、插件对带 language-* 的 code 先加 hljs 类再查语言，mermaid 特判是严格相等 `className === "language-mermaid"`（MermaidMarkdown.tsx L415）必失配、图表链路全断——C-3 改 `rehypeHighlight({ languages 11 语言显式注册, plainText: ['mermaid'], detect: false })`，特判改 `className?.includes("language-mermaid")`，SPEC 的 subset/ignoreMissing 机制表述与 Step 2 前提重写。2) P0-2 lowlight@3 缺省 common 集含 rust 等 37 语言会高亮清单外语言，且空 hljs 类先于语言查找——languages 显式注册替代 subset；renderCodeBlock 剥插件注入的空 hljs 类或放宽 T-CB3（选一并说明）；SPEC 写明双端语言注册表同源（mobile LANG_ALIAS 与 desktop languages 同集合）否则 T-CB13 挂。3) P0-3 RN 回退无实现载体：RichContentBody.tsx 已是纯文本回退（只渲染 Text），FileMarkdownPreview overLimit 时 html undefined，C-12 classesStyles 方案作用于不存在的 RenderHTML 树——建议 PRD 需求 6 与验收第 8 条降级为「维持纯文本现状」，撤 C-12/Step 9/T-CB12 或改回归断言。4) P1-1 C-4 行号实为 shell.css L5914-5922 非 L5880；需明确用户气泡 pre/code 覆盖用可区分背景变量（--surface-inset vs --background）。5) P2-1 C-7 双轨冗余：覆盖 fence renderer 后 highlight 选项不被消费，收敛为「覆盖 fence、内部直调 resolveHighlight」。约束：PRD 与 SPEC 同步一致，保持步骤行与测试表格式，T-CB 编号映射更新。

assistant:
已闭合全部 5 条（3 P0 + 1 P1 + 1 P2），仅改两份文档，实现代码零改动。证据核实：主树 MermaidMarkdown.tsx L415 确为严格相等特判；RichContentBody.tsx 只渲染 Text（注释 Rollback plain-text body）；FileMarkdownPreview.tsx L306-320 overLimit/非 webview 时 mdBodyHtml 为 undefined；shell.css 用户气泡覆盖在 L5914-5922（同为 var(--surface)）。
- P0-1：选型表 desktop 行、兼容性事实第 6 条重写为「三层保护」（languages 注册表不含 mermaid + plainText 加类前 return + includes 宽匹配），并写明 v7 真实行为（subset 仅 detect 路径、先加 hljs 类再查语言、ignoreMissing 不存在）；C-3 与 Step 2 同步改写。
- P0-2：选剥类方案并说明理由（空 hljs 类会让 .hljs 选择器误命中降级块）；新增兼容性事实第 7 条（剥空 hljs 类）；语言清单节补「双端注册表同源」段（10 模块，html→xml、shell→bash 别名承载，desktop languages 显式注册同时替换缺省 common 集）；T-CB3 维持「无 .hljs 类」原断言。
- P0-3：采审查建议的前者——PRD 需求 6/验收第 8 条/包含范围均降为「维持纯文本现状」；C-12 改「无代码改动 + 行为不变回归」；Step 9 同步；T-CB12 改为 RichContentBody 纯文本回归断言；结构树删 prepare-rich-html.ts 与 build-rich-content-styles.ts 两行。
- P1-1：C-4 行号改 L5914-5922，写明用户气泡 pre 覆盖用 --surface-inset、行内 code 用 --background（现状同为 --surface 会趋同）；T-CB5 补变量断言。
- P2-1：C-7/Step 5/结构树/选型表 mobile 行/风险表统一收敛为「覆盖 fence renderer 单一出口、内部直调 resolveHighlight，不挂 highlight 选项」；T-CB11 措辞同步。
PRD/SPEC 同步：RN 回退口径两端一致；注册表同源表述覆盖 C-3/C-6/风险表/T-CB13；残留的 subset/ignoreMissing 字样均为「解释 v7 行为、说明为何弃用」的语境，非配置残留。
