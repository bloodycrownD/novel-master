---
date: 2026-08-27
title: markdown-code-block-render 实现轮（Step 1~9、11 完成，Step 10 真机验收待做）
keywords: markdown-code-block-render, rehype-highlight, highlight.js, fence renderer, renderCodeBlock, data-lang, hljs, nmMode, T-CB1~T-CB13
abstract: 在 worktree .woktree/markdown-code-block-render（分支 feat/markdown-code-block-render）按 spec 实现 markdown 代码块块级形态+语言标签+语法高亮。desktop：MermaidMarkdown 挂 rehype-highlight（languages 显式注册 10 模块 + aliases bash:['shell'] + plainText:['mermaid'] + detect:false），特判改 includes，新增 code-block.tsx（normalizeFenceLang 同表 + renderCodeBlock，归一化表外语言剥空 hljs 类）；shell.css 块级形态（pre 用 --surface-inset、行内 code --background）+ 11 个 --hljs-* 双主题变量 + pre[data-lang]::before。mobile：highlight-code.ts（core 注册 10 语言 + LANG_ALIAS + resolveHighlight）、prepare-transcript-rich-html.ts 覆盖 renderer.rules.fence 单一出口（不挂 highlight 选项）、sanitize 放行 pre[data-lang]、rich-content-styles 块级+两套 .hljs-*（html[data-nm-mode="dark"] 前缀）、新增 shared/theme-mode.ts（inferThemeModeFromBg，mermaid-core 改复用并 re-export parseColorToRgb）、两管线 bridge applyTheme 写 dataset.nmMode。RN 回退无代码改动，T-CB12 钉纯文本回归。9 个 commit；desktop 91/91、mobile 838/841（3 个 unhide 失败为基线同败，已到主 worktree 验证）；app.css 增量 1.9KB/1.8KB < 3KB 预算；vite build 通过。坑：rehypePlugins 要传 [插件, 选项] 元组，传 rehypeHighlight({...}) 的返回值会在 unified freeze 阶段崩 "Cannot use 'in' operator to search for 'children' in undefined"。
---

user:
impl-markdown-code-block-render 节点，在 worktree .woktree/markdown-code-block-render 按 spec（docs/Iterations/markdown-code-block-render/spec.md，经 2 轮审查修订，rehype-highlight 配置以最终文本为准：languages 显式注册 + aliases bash:['shell'] + plainText:['mermaid'] + detect:false，无 subset/ignoreMissing）实现 Step 1~9、Step 11（Step 10 真机验收不做）。要点：双端依赖安装、desktop renderCodeBlock + CSS、mobile highlight-code + fence 覆盖 + sanitize + CSS + theme-mode 共享推断、RN 回退维持纯文本（T-CB12 回归断言）、双端测试 T-CB1~T-CB13、build:webview 门禁记录体积、CHANGELOG Unreleased。约束：开始前 npm install、按逻辑块提交、每块定向测试、依赖 core dist 先 build、最后双端全量测试与 build:webview。

assistant:
按逻辑块 9 个 commit 完成（8c0fb7a deps / 96cd82e desktop render / d703131 desktop css / 9563c92 desktop tests / d590dc7 mobile render / 25556e3 sanitize / 4b2c99b mobile css+theme-mode / 0e29e9a mobile tests / 6c7587d changelog）。
关键实现事实：
- rehype-highlight@7.0.2 选项签名实测与 spec 一致（aliases/detect/languages/plainText/prefix/subset，无 ignoreMissing）；createLowlight(languages) 显式注册即整体替换 common 集；plainText 命中在加 hljs 类之前 return（源码 L88-94 核实）。
- highlight.js@11 语言模块内置别名实测：ts/tsx/js/jsx/py/yml 均内置（typescript 模块 aliases 含 ts、tsx），唯 shell 不在 bash 内置 aliases（仅 sh/zsh）——desktop aliases 显式配 + mobile LANG_ALIAS 归一化双覆盖。
- 双端版本：desktop 直接依赖 highlight.js@11.12.0（languages 选项引子模块，显式声明避免 import 传递依赖），lowlight 内部仍 11.11.2；mobile 11.12.0。T-CB13 统一样例（13 块+shell）实测双端 data-lang 集合与 18 个 token 类名并集完全一致（hljs-attr/attribute/built_in/comment/function/keyword/name/number/operator/params/punctuation/section/selector-class/string/strong/subst/tag/title）。
- 坑：react-markdown rehypePlugins 必须传 [plugin, options] 元组；传 plugin({...}) 返回值（transformer）会在渲染期崩 "Cannot use 'in' operator to search for 'children' in undefined"（栈落在 rehype-highlight visit）。类型用 PluggableList（from "unified"）。
- mobile jest 测试文件含 JSX 必须 .tsx 后缀（.ts 下 babel 不解析 JSX）。
- CSS 源码断言测试的两个误伤：rehype 块内注释含 html[data-theme="dark"] 字样会让 indexOf 切分错位（定位要带 ' {'）；rich-content-styles 注释含「勿用 overflow-x:auto」会误伤 not.toContain（先剥注释再断言）。
- worktree 新环境需先 build workspace 包否则全量测试挂构建产物缺失：desktop prebuild（sksp-* 等）+ build:icons/build:renderer/build:main/build:preload 后 91/91；mobile 需 build tdbc-driver-op-sqlite 等 4 包后 838/841。use-chat-tab-message-actions-unhide 3 例失败为主 worktree 基线（b3429b0）同败，与本迭代无关。
- 体积：build:webview 后 chat-transcript app.css 15902→17841（+1.9KB）、rich-document 7734→9543（+1.8KB），均 < 3KB/包预算。
剩余：Step 10 manual_user 真机验收（四场景明暗主题、批注 T-CB14、流式 T-CB15）未做（按任务要求跳过）。

---

date: 2026-08-27（追加）
title: markdown-code-block-render CR 第一轮 fix-spec 落盘
keywords: cr-fix-spec, MF-1, MF-2, 内置别名, escapeHtml, C-1 回写
abstract: 节点 spec-fix-markdown-code-block-render（DAG v2，只改文档不改代码）：新建 docs/Iterations/markdown-code-block-render/cr-fix-spec.md（base b3429b0 / head 1fad168 / review_round 1 / 状态 draft），写入 2 条 P2 + 1 条 spec 回写，并同步执行 C-1 回写（spec 变更点 C-1 补记 desktop highlight.js@^11.12.0 直接依赖，languages 选项需直接 import 语言子模块）。MF-1 [P2][B]：hljs 模块内置别名（javascript 含 mjs/cjs、typescript 含 mts/cts、xml 含 xhtml/rss/atom/xsd/xsl 等）随 languages 注册进 lowlight，desktop ```mjs 高亮但无 data-lang，mobile 被 LANG_ALIAS 门控走纯文本，双端不一致与 spec「清单外不高亮」冲突，T-CB13 样例未覆盖；推荐改法 b（spec 回写 deviation + 样例补 mjs 块钉死），备选 a（双端表同步补别名，范围变更）。MF-2 [P2][D]：prepare-transcript-rich-html.ts L23 手拼 class="language-${rawLang} hljs" 未转义，当前不可利用（表 key 全字母数字，含引号必查表失败走默认 fence 且 sanitize 兜底）但隐式依赖无防护；改法 rawLang 过 md.utils.escapeHtml 再拼 + 补引号 lang 测试。Open questions 待拍板：a/b 方案、RN bundle 实测数字回填、Step 10 是否补做、双端色表无契约锁、缩进 code block 防回归。commit：docs(cr): 记录 code-review 第一轮 fix-spec（含 spec.md C-1 回写）。

user:
spec-fix-markdown-code-block-render 节点，worktree .woktree/markdown-code-block-render，只改文档不改实现代码；fix-spec 路径 docs/Iterations/markdown-code-block-render/cr-fix-spec.md，commit 到 feat/markdown-code-block-render，message 固定 docs(cr): 记录 code-review 第一轮 fix-spec；spec.md/prd.md 只读参考（C-1 回写为明确授权的例外）。结构：元信息/Must-fix/Spec deviations/Open questions（待拍板）/已豁免（空）/合并后 QA/K 节建议。

assistant:
核实了双端源码差异后落盘：desktop ```mjs 实际表现是「rehype-highlight AST 层命中内置别名生成高亮 span，renderCodeBlock 归一化失败后剥 hljs 类、不出 data-lang」；mobile 则整体走默认 fence。C-1 回写直接改 spec 变更点清单 C-1 行（补 highlight.js ^11.12.0 直接依赖及原因），与 fix-spec 同一 commit。
