---
date: 2026-08-24
title: 导入后快照不刷新 + mermaid 报错无原因 两项问题调研
keywords: 导入角色卡, importVfsZip, rule_snapshot, file_cache, sessionApiPromptTokenCache, clearDomain, assemble-workplace-display, mermaid, MermaidMarkdown, mermaid-core, failedCache, parse error
abstract: 调研两项问题：①导入角色卡/zip 后提示词与文件不一致——根因是导入链路缺了置位/压缩同款的「清 rule_snapshot + file_cache + 失效 token cache」三件套，workplace 前缀抱旧缓存；②mermaid 渲染失败不显示原因——双端错误对象全程在手，只是最后一层 catch 丢弃（mobile 甚至已缓存进 failedCache 无人读），最小改动在消费端接住并展示。
---

user:
两个问题：①参考压缩和置位，希望导入角色卡/zip 后清空 rule_snapshot 让 workplace 刷新（现在导入后工作区不刷新，提示词与文件不一致）；②mermaid 渲染报错不给失败原因，不方便找语法错误。

assistant:
brain-storm 两个并行子代理（导入链路那个首派超长失败，精简重试成功）：

问题①根因：导入 core service（character-card-import.service.ts 的 import L104/importFromBytes L164；vfs-zip-io.service.ts 的 import L153-225）事务内删前缀子树重建文件，但**不发事件、不清 KKV、不失效 token cache**。提示词路径 assemble-workplace-display.ts L92-110：loadOrCreateRuleSnapshot 命中旧 canon 即不重评估（L93，头注释 L78-81），逐 entry loadOrFillFileCache 命中无条件返回旧正文（load-or-fill-file-cache.ts L37-42，无 mtime 校验）→ 文件已变提示词没变。UI 树其实会刷新（materializeLiveView 无缓存 + notifyWorkspaceMutated），断点纯在提示词侧。置位（message-transcript-effects.service.ts L147-172）/压缩（run-compaction.ts L69-81）的清空三件套 = clearDomain(rule_snapshot) + clearDomain(file_cache) + sessionApiPromptTokenCache.invalidate(sessionId)。方案：在两个导入 service 成功路径做同款三件套（抽 helper），一处覆盖双端+CLI。**scope 坑**：KKV 按 sessionId 存，session scope 导入清自身即可；project/global scope 导入影响所有引用会话，需定位受影响 session 集合或接受惰性失效（要单独立项）。mobile 端 VfsFileManager.tsx L839-843 注释实锤 core 导入不写 workplace_dir_rule（UI 自补默认规则）。

问题②根因：双端错误对象全程在手只被最后一层 catch 丢——desktop MermaidMarkdown.tsx L298-311 MermaidBlock effect `.catch(() => setFailed(true))` 丢 err，失败缓存只存哨兵 FAILED_PLACEHOLDER（L216-231）无错误文本；mobile mermaid-core.ts L217 裸 catch 丢 err，但 L146 已把 err 存进 failedCache 无人读。mermaid 11.16.1 render reject 原始 error（jison Parse error message 含行号与期望 token；未知图类型 UnknownDiagramError）；getErrorMessage/isDetailedError 未从主入口导出，兜底 err instanceof Error ? err.message : String((err as DetailedError).str ?? err)。最小改动：desktop 加 failedMessageCache（key 同 svgCache，LRU/测试重置连带维护）+ badge 显示原因；mobile catch(err) 写 pre.dataset.mermaidError + CSS attr() content（rich-content-styles.ts 单源覆盖两管线，禁 .mermaid-block.mermaid-failed 组合选择器）。测试未锁死现状，可补错误文本断言。post 通道现成可传 RN 日志（可选）。

待用户拍板：①导入清空的范围（先只做 session scope？project/global 怎么办）②mermaid 错误展示的形态（badge 文案 vs 等宽小字行）。之后走 PRD/spec 流程。

user:
project/global 不用管，只更改 session 的导入就好。

assistant:
PRD 落盘 `docs/Iterations/import-cache-align-and-mermaid-error/prd.md`（dependency 指向 character-card-import）。两需求合一个小迭代：①仅 session scope 导入（角色卡+zip）成功后做与压缩同款三件套（清 rule_snapshot+file_cache 两域 + 失效 prompt token cache），清空尽力而为不阻塞导入，抽共享 helper；project/global 明确不动（AC-3 锁定不受影响）。②双端 mermaid 失败展示原因（desktop 失败缓存哨兵扩为哨兵+错误文本；mobile dataset.mermaidError + CSS attr()，样式单源盖两管线，禁组合选择器）；错误提取口径 err.message / DetailedError.str 兑底，原样展示。AC 1-6。待用户确认 PRD。

user:
（spec-generate）看情况派遣 agent。

assistant:
spec 落盘 `docs/Iterations/import-cache-align-and-mermaid-error/spec.md`。判断：大面探索已在 brainstorm 阶段完成，只补派 1 个聚焦探索子代理钉 spec 级细节。关键拍板：①helper `clearSessionPromptCaches(sessionId, sessionKkv)` 整体 try/catch 吞错（与置位/压缩裸 await 先例**有意不同**，因导入已落库）；②工厂签名被 mobile 测试钉死（calls[0]?.[1] undefined），sessionKkv 在工厂内部 createSessionKkvService(conn) 自建，Default 构造加可选注入，缺省不清空；③kind 门闸保护 NewSkillModal 的 meta-scope zip 导入不被误伤；④desktop 错误缓存四处连带清理（LRU/TTL/成功覆盖/reset）+ lookupMermaidFailedError 导出 + useState 初始化与 effect catch 双通道（静态渲染不跑 effect）；⑤mobile CSS `attr(data-mermaid-error, fallback)` 带 fallback。陷阱记录：resolve-vfs-scope.ts 的 workspaceScope "session" 解析为 project scope（历史命名），真门闸是 Core 层 VfsScope.kind。Step 1-3 可并行 + Step 4 manual；T-IC1-5/T-MD1-3/T-MV1-3。待用户确认。

user:
新会话恢复记忆。

assistant:
已恢复：token-usage-stats 迭代 dev-ready 终态（17/17 闭合，core 2160/2160），当前迭代 spec 仍待用户确认后才进 code-dev-loop。

user:
（code-dev-loop）开发吧。

assistant:
用户确认 spec，进 code-dev-loop。从 main（2f1c4fc）开新分支 feat/import-cache-mermaid-error（token-usage-stats 的 30 commits 留在原分支未合并）；DAG：wave-0 三个 impl 并行（core/desktop/mobile 文件集不重叠）→ wave-1 三包 verify → wave-2 cr-func。并行子代理禁 git commit，主代理分组统一提交。

user:
（impl-mobile 子代理任务）mobile mermaid 渲染失败时展示失败原因：mermaid-core 裸 catch 改 catch(err) 提取消息写 data-mermaid-error；rich-content-styles 的 mermaidFailedCode::before 改 attr(data-mermaid-error, fallback)；禁组合选择器/禁 overflow-x:auto；改完必须 build:webview；扩 T-MV1（源码+CSS+dist 契约）T-MV2（错误消息提取纯逻辑）。

assistant:
impl-mobile 执行中发现 spec 细节偏差：spec/任务写 pre.setAttribute('data-mermaid-error')，但 CSS attr() 只能读伪元素宿主自身属性——mermaidFailedCode 选择器匹配的是 code（pre.mermaid-failed > code.language-mermaid），pre 上的属性读不到、真机永远落 fallback。修正为 code.setAttribute（catch 内 code 引用在手），CSS 按任务原文改即真正生效，契约断言 setAttribute('data-mermaid-error' 不带元素名照样命中。新增导出 extractMermaidErrorMessage（统一口径 err.message / {str} / String 兜底）供 catch 与 T-MV2 纯逻辑共用。

user:
（impl-desktop 子代理任务）desktop mermaid 渲染失败时展示失败原因：failedErrorCache 四处连带清理（LRU/TTL/成功覆盖/reset）、lookupMermaidFailedError 导出、MermaidBlock failed 态 badge 下 <pre class=mermaid-block__failed-reason>（useState 初始化 + effect catch 双通道）、shell.css 样式、T-MD1~T-MD3。

assistant:
impl-desktop 完成：MermaidMarkdown.tsx 新增模块级 failedErrorCache（key 同 svgCache）+ extractMermaidErrorMessage（与 mobile 同口径），四处连带清理全部接入；MermaidBlock failed 态双通道（useState 初始化查 lookupMermaidFailedError 供 renderToStaticMarkup 静态渲染，effect 内 knownFailed/catch 两分支 setFailedError，成功/缓存命中时清 null）。shell.css 加 .mermaid-block__failed-reason（等宽小字 danger 色 pre-wrap anywhere）。测试 T-MD1~T-MD3 全绿（13/13，含非 Error 形态 {str} 口径断言）。陷阱实锤：node 22.22 的 node --test 不认 --tsconfig，得照 run-tests.mjs 用 npx tsx --tsconfig tsconfig.renderer.json --test + NODE_OPTIONS --import register-electron-mock.mjs；tsconfig.renderer.json 全量 tsc 本就有几十处历史错误（含既有 TTL 测试的 t.mock.timers.enable({now}) 类型报错，新测试同款写法同款报错，非本期引入）。

user:
（impl-core 子代理任务）实现 session scope 导入后清空提示词缓存三件套：新建 service/vfs/logic/clear-session-prompt-caches.ts（整体 try/catch 吞错 + console.warn）；两个 Default 构造加可选 sessionKkv（缺省不清空）；工厂内部 createSessionKkvService(conn) 自建、对外签名不变；T-IC1~T-IC5。

assistant:
impl-core 完成（无 commit，交主代理统一提交）：①新建 helper clearSessionPromptCaches（顺序 clearDomain(rule_snapshot) → clearDomain(file_cache) → sessionApiPromptTokenCache.invalidate，整体吞错 warn，注释写明与置位/压缩裸 await 有意不同的原因）；②character-card-import / vfs-zip-io 两个 Default 构造 options 加可选 sessionKkv，事务成功提交后按 scope.kind === "session" 门闸调用；③两工厂内部自建 sessionKkv 注入，签名 (conn, options?) 不变（mobile 钉死），backfillBaseline 不透传现状保持。测试：新建 clear-session-prompt-caches.test.ts（createMemorySessionKkv 故障注入，验 pending 域保留 + 吞错短路）；character-card-import.test.ts 扩 T-IC1/3/4（T-IC3 用 project scope 负例）；vfs-zip-io.test.ts 扩 T-IC2/3（global 形态负例）/5（双工厂单参构造 + 内部装配行为验证）。验证：聚焦三文件 42/42 绿，vfs + character-card 全目录 295/295 绿，core src typecheck 干净；tsc 直跑 tsconfig.test.json 有 347 个既有 TS6059（rootDir 配置噪音，全仓库都有，非本期引入）。工具路径陷阱：本项目工具路径需带 novel-master/ 前缀（create_directory 用裸 packages/... 会报 outside project）。
