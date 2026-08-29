---
repo: /home/bloodycrown/Dev/novel-master/.woktree/markdown-code-block-render
base: b3429b0
head: 1fad168
review_round: 1
dag_version: 2
状态: closed（MF-1 / MF-2 已闭合，C-1 已回写；OQ1 已拍板方案 b 并数双端统一化执行）
---

# markdown 代码块渲染 — Code Review 第一轮 fix-spec

范围：2 条 P2（MF-1 / MF-2）+ 1 条 spec 回写（C-1，本轮已执行）。只改文档，不改实现代码；MF-1 / MF-2 的代码与测试修复由后续 wave 按 Must-fix 执行。

## Must-fix

### MF-1 [P2][B] hljs 模块内置别名双端高亮不一致（与 spec「清单外不高亮」冲突）

- **id**：MF-1
- **严重度**：P2
- **维度**：B（双端行为一致性）
- **文件**：`apps/desktop/renderer/components/MermaidMarkdown.tsx`（`languages` 显式注册）、`apps/desktop/renderer/components/code-block.tsx`（`FENCE_LANG_ALIAS` / `renderCodeBlock`）；对照 `apps/mobile/src/components/rich-content/highlight-code.ts`（`LANG_ALIAS` 门控）
- **问题**：hljs 语言模块自带内置别名，随 `languages` 显式注册一并进入 lowlight 注册表——javascript 模块 aliases 含 `mjs`/`cjs`，typescript 含 `mts`/`cts`，xml 含 `xhtml`/`rss`/`atom`/`xsd`/`xsl` 等。这批别名**不在**双端归一化表（`FENCE_LANG_ALIAS` / `LANG_ALIAS`）里，于是同一 ```` ```mjs ```` 块：desktop 被 rehype-highlight 在 AST 层命中别名高亮（span 已生成；`renderCodeBlock` 归一化失败后仅剥 `hljs` 类、不出 `data-lang`，结果是「高亮但无语言标签」）；mobile 因 `LANG_ALIAS` 门控查表失败走默认 fence 纯文本。双端一高一不高，与 spec「语言清单与归一化」节「不在清单且无别名的语言：不出 data-lang、不高亮、纯文本块级」直接冲突。T-CB13 统一样例未覆盖此类内置别名，契约断言漏网。
- **改法**：推荐 **b**，备选 a：
  - **b（推荐）**：接受现状，在 spec「语言清单与归一化」节回写 deviation——desktop 侧 hljs 模块内置别名跟随模块注册进 lowlight，会被高亮但不出语言标签；mobile 侧仅 `LANG_ALIAS` 表内语言高亮，内置别名不跟随。统一样例补 ```` ```mjs ```` 块钉死当前行为（desktop 高亮、mobile 纯文本），T-CB13 按此补双端各自行为断言。
  - **a（备选）**：双端 `FENCE_LANG_ALIAS` / `LANG_ALIAS` 表同步补入这批内置别名（`mjs`/`cjs`/`mts`/`cts`/`xhtml`/`rss`/`atom`/`xsd`/`xsl`…），双端一致高亮且 `data-lang` 正常输出——属语言清单范围变更，须回写 spec「语言清单与归一化」节并同步 PRD 口径。
- **验收**：方案 b——spec deviation 与样例 ```` ```mjs ```` 块落盘，双端各自行为有测试钉死；方案 a——双端 ```` ```mjs ```` 均高亮、`data-lang` 一致、两表双端同步（T-CB13 通过）。
- **来源**：CR-R1（评审实证：highlight.js@11 javascript 模块 aliases 含 mjs/cjs）
- **闭合状态**：✅ 已闭合（CR-R1 fix wave）——按方案 b 执行并数双端统一化：mobile `resolveHighlight` 门控改为「归一化表优先、表外回退 hljs 注册表」，与 desktop rehype-highlight 落在同一 hljs 注册表同一判定逻辑；`mjs`/`cjs` 双端均高亮但不出 `data-lang`，`rust` 等注册表未命中双端均纯文本。spec「语言清单与归一化」节已回写 deviation 与双端注册机制差异说明，统一样例补 ` ```mjs ` 块，T-CB13 双端各自补 mjs/cjs 行为断言锁定。

### MF-2 [P2][D] mobile fence renderer 手拼 class 未转义（隐式依赖表 key 字符集不变式）

- **id**：MF-2
- **严重度**：P2
- **维度**：D（防御性 / 注入面）
- **文件**：`apps/mobile/src/components/rich-content/prepare-transcript-rich-html.ts` L23
- **问题**：fence 覆盖手拼 `class="language-${rawLang} hljs"`，`rawLang`（fence info 首词）未经 HTML 转义直接进属性。当前**不可利用**：`normalizeFenceLang` 的表 key 全为字母数字，含引号的 `rawLang` 必然查表失败走 `defaultFence`（默认 escape 路径），且下游 `sanitizeRichHtml` 兜底。但这是对「表 key 字符集恒为字母数字」这一不变式的**隐式依赖**，代码里无防护也无注释——未来有人往表里加含特殊字符的 key 时，属性注入面即被打开。
- **改法**：`rawLang` 先过 `md.utils.escapeHtml` 再拼接（`class="language-${md.utils.escapeHtml(rawLang)} hljs"`）；补测试：lang 首词含引号（如 ```` ```ab"c ````）时走默认 escape，输出不含未转义反射的属性或标签。
- **验收**：新增单测通过；含引号 lang 的 fence 输出经断言无注入向量。
- **来源**：CR-R1
- **闭合状态**：✅ 已闭合（CR-R1 fix wave）——`rawLang` 拼接前过 `markdown.utils.escapeHtml`（`< >` 进入 sanitize 前已转义；`&quot;`/`&amp;` 会被出口 `decodeAfterSanitize` 按既有设计回解，无裸标签反射）。补两组测试：表 key 含 `"`/`<`/`&` 走拼接路径无标签注入向量（mock 透传锁定转义生效）、含特殊字符 lang 走默认 fence 无注入向量（真实 sanitize 管道）。另断言过程发现既有管道组合行为新开 OQ6（见 Open questions）。

### C-1 [P2][K] spec 变更点 C-1 补记 desktop `highlight.js` 直接依赖（本轮已回写）

- **id**：C-1
- **严重度**：P2
- **维度**：K（spec / 文档一致性）
- **文件**：`docs/Iterations/markdown-code-block-render/spec.md`（变更点清单 C-1 行）；对应实现 `apps/desktop/package.json`（`highlight.js: ^11.12.0`）
- **问题**：desktop 实际新增了 `highlight.js@^11.12.0` **直接依赖**——`MermaidMarkdown.tsx` 的 `languages` 选项需直接 `import "highlight.js/lib/languages/*"` 语言子模块传入（rehype-highlight / lowlight 不 re-export 语言模块）。spec 变更点 C-1 定稿时只记了 `rehype-highlight`（^7），依赖清单缺记，spec 与实现不一致。
- **改法**：spec 变更点 C-1 行补记 `highlight.js`（^11.12.0）直接依赖及原因。**本轮已执行回写**（随本 fix-spec 一并 commit）。
- **验收**：spec C-1 行包含该依赖及「languages 选项需直接 import 语言子模块」说明，与 `apps/desktop/package.json` 实际一致。
- **来源**：CR-R1（C-1 偏差复核）

## Spec deviations

1. **C-1 依赖**：desktop 实际新增 `highlight.js@^11.12.0` 直接依赖，spec 定稿遗漏——本轮已回写 spec 变更点 C-1（见 Must-fix C-1）。
2. **双版本并存 11.12.0 / 11.11.2**：desktop 直接依赖 highlight.js@11.12.0，而 rehype-highlight → lowlight 传递依赖内部为 11.11.2，node_modules 双版本并存——实现轮已复核同意，语法模块同源、T-CB13 契约断言兜底，**非 must-fix**。
3. **MF-1 即 spec 偏差**：desktop 内置别名高亮与 spec「清单外不高亮」冲突，属实现与 spec 的真实偏差——待 a/b 方案拍板后按所选方案回写 spec（见 Must-fix MF-1、Open questions Q1）。
4. **Step 10 跳过**：`phase-manual-acceptance`（blocking: manual_user，T-CB14 / T-CB15）实现轮按任务约束跳过未做——是否补做见 Open questions Q3。

## Open questions（待拍板）

1. **MF-1 方案 a / b 拍板**：接受现状回写 deviation（b，推荐），还是双端表同步补别名扩清单（a，范围变更）。
2. **RN bundle 实测数字回填**：spec 风险节与 CHANGELOG 均为「约 100KB 级 / min、30KB 级 / gzip」估算口径，需以构建产物实测数字回填（对齐 Step 8 的记录口径）。
3. **Step 10 真机验收是否补做**：四场景 × 明暗主题人工验收 + T-CB14 批注回归 + T-CB15 流式验收当前均未执行。
4. **双端色表无契约锁**：desktop `shell.css` 的 `--hljs-*` 与 mobile `rich-content-styles.ts` 的 `.hljs-*` 色值各持一份，无测试或脚本校验一致，漂移只能靠目测发现——是否补一致性断言。
5. **缩进 code block 防回归断言**：现有测试只覆盖 fence 形态，4 空格缩进代码块是否需要补「不被高亮改写」的防回归断言。
6. **（新增，MF-2 验收过程发现）无空格引号拼接 + 出口 decode 的既有组合行为**：fence 首词为 `x"onmouseover="alert(1)`（引号闭合后无空格拼属性名）时，markdown-it 默认 fence 不转义引号，sanitize-html 将整串视为 class 值转义，但出口 `decodeAfterSanitize` 按既有设计回解 `&quot;`，最终 HTML 仍含 `class="language-x"onmouseover="alert(1)"` 形态（浏览器 tokenizer 可解析出事件属性）。该行为在本轮修复前即存在（defaultFence 路径，与 MF-2 拼接路径无关，且拼接路径仅对表/注册表命中 lang 生效、实际不可达），超出本轮 must-fix 范围——建议后续迭代评估：出口 decode 收窄 quot 回解范围或 fence 首词白名单化。

## 已豁免

（无）

## 合并后 QA

- 双端 `npm run typecheck` + `npm test` 全绿（mobile 既有 3 例 unhide 失败为主 worktree 基线同败，与本迭代无关）。
- MF-2 修复后：新增「lang 首词含引号走默认 escape」用例通过。
- MF-1 拍板后：按方案 b 则 spec deviation + 样例 ```` ```mjs ```` 块 + T-CB13 双端行为断言落盘；按方案 a 则双端表同步且 T-CB13 原有一致性断言通过。
- `npm run build:webview` 门禁通过，`app.css` 体积增量复核（预算 < 3KB/包，实现轮实测 +1.9KB / +1.8KB）。
- 若补做 Step 10：四场景 × 明暗主题人工验收、T-CB14 批注回归、T-CB15 流式验收。

## K 节建议（spec / 文档后续动作）

1. C-1 依赖补记本轮已完成，无需跟进。
2. MF-1 拍板后按方案回写 spec「语言清单与归一化」节（deviation 或清单扩充），并同步统一样例与 T-CB13 描述。
3. 建议在 spec「语言清单与归一化」节补一句双端注册机制差异说明（desktop 别名随模块注册进 lowlight、mobile 仅显式表门控），降低后续评审的误解成本——可与第 2 条一并落。
4. RN bundle 实测数字回填 spec 风险节（「高亮库体积」行）与 CHANGELOG 对应条目。
5. 可选：双端 highlight.js 版本 pin 口径（desktop 直接 11.12.0 / lowlight 传递 11.11.2 并存的同意结论）在 spec 风险节「双端一致性」行补一句备案，避免后续重复复核。
