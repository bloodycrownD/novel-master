---
date: 2026-11-21 00:00
title: p27 R7 探针：renderer signatures 374 条裁决表落盘（豁免 119 / 收一行 255）
keywords: p27, R7, nm-style, check-signatures, renderer, 形态豁免, await 解包, 成员链基准, hook 豁免, 宽度闸 200, prettier-guard, r7-renderer-triage
abstract: p27 迭代 R7 探针任务：desktop/renderer 扩面后 signatures 首曝 374 条（ARGS 140/VARDECL 119/PARAMS 100/IMPORT 9/ASSIGN 6）逐条裁决。方法=AST 镜像规则判据全量归类+每类人工复核+合成 fixture 实证四判据+对拍 prettier-guard 宽度约定。裁决=豁免 119（hook 26/JSX 16/成员链 22/await 解包 51/宽度闸 3/hook 解构形参 1）+ 收一行 255（240 直接并一行+15 辅助重构）。豁免全部落规则层 tools/nm-style/src/rules/signatures.ts（M1 await unwrap 与 isBlockExpression 共用解包、M2 ARGS 首实参基准改 method name token 行、E1 use* 形态、E2 JSX 上下文、E3 hook/组件解构形参、E4 非 call RHS 展平>200 闸），KFP 不用（匹配键做不了形态级）；spec §3.3「全阻断、无豁免」需同步修订。裁决表=docs/Iterations/p27-backlog/r7-renderer-triage.md；本轮零源码改动，波 2 照表执行。
---

user（R7 探针任务书，2026-11-21）：
p27 迭代 R7 探针，工作目录 D:\worktree\p27-backlog。背景：nm-code-style 一行规则（check-signatures）此前不扫 desktop/renderer，nm-style 扩面后首次可见 374 条 signatures findings（ARGS 140/VARDECL 119/PARAMS 100/IMPORT 9/ASSIGN 6）。用户授权执行 agent 自行裁决边界（不预设豁免 vs 全适用）；锚点=React 生态惯用形态（useState 解构/深嵌 JSX 内联回调/组件 props 解构）为豁免候选、纯 TS 逻辑行收一行、IMPORT 9 条按既有规则。要求：每类至少 10 个实际样本读源码；豁免必须落 nm-style 规则层（按形态豁免优于逐条登记）；清理不得与 prettier 默认宽度冲突（--print-width 200 自检）；不修改源码，只出裁决表至 docs/Iterations/p27-backlog/r7-renderer-triage.md。

assistant（探针执行 + 裁决表落盘，2026-11-21）：
环境：全局 nm-style bin 指向失效路径（nvm 目录漂移），改走 `node tools/nm-style/bin/nm-style.mjs`；worktree 无 node_modules/typescript，建 junction `D:\worktree\p27-backlog\node_modules → D:\Dev\Js\novel-master\node_modules`（保留供波 2 使用，勿删）。
全量取数：`check apps/desktop/renderer --json` 共 806 条（signatures 374 + 其他规则 432），374 条逐条 AST 归类（临时脚本镜像 signatures.ts 判据，加 callee/hook/JSX/成员链/展平长度维度）+ 每类人工复核源码 + 合成 fixture 实证（tmp-r7-fixture.ts 四判据全中：非 await 多行对象不报 vs await 版误伤实锤；链式 escapeHtml 一条语句记 4 条 ARGS；class 拼接一条记 2 条）。
裁决（豁免 119/收一行 255）：ARGS 豁免 56（hook 18+JSX 16+成员链 22）/收一行 84；VARDECL 豁免 61（hook 8+await 解包 51+宽度闸 2）/收一行 58；PARAMS 豁免 1（useChatMessagesScrollFollow:24 hook 解构形参；组件 props 命中实为 0 条，前瞻豁免）/收一行 99（88 直接+11 抽具名类型）；IMPORT 9 全按既有规则收（一行形式 62-79 字符）；ASSIGN 豁免 1（三元大对象 >400）+收 5。关键发现：①VARDECL 的 await 误伤是规则 bug（checkOneLineValue:185 call 宽容分支探不到 AwaitExpression 内层，isBlockExpression 反而已解包）；②ARGS firstArgMoved 拿调用起始行当基准对成员链语义错位（实参都紧跟各自调用点）；③renderer 现状无组件 props 解构命中；④收一行桶 top 文件=useColumnSplitters 24/ConversationPanel 15/App 15/workspace-actions 13/ChatComposer 12。
豁免落地方案（全落 rules/signatures.ts，core 零影响=豁免只减不增且 core 现状 0 findings）：M1 抽 unwrapExpression 与 isBlockExpression 共用（await/paren/as 解包后判 call 宽容）；M2 firstArgMoved 基准改「成员调用 method name token 行，否则 callee 结束行」；E1 callee/initializer 匹配 /^use[A-Z]/ skip（26 条）；E2 调用处于 JSX 属性/表达式或实参含 JSX skip（16 条）；E3 解构形参且函数为 use* 或体产 JSX skip（1 条+前瞻）；E4 非 call RHS 展平>200 skip（3 条，200 与 prettier-guard 工作宽度同源）。spec 同步面：signatures.ts 头注释与 nm-code-style §3.3「全阻断、无豁免 verdict」需改写；KFP 保留个案 rule-conflict 用途、不做形态豁免容器。测试面：tools/nm-style/test/signatures.test.mjs 补 M1/M2/E1-E4 正反用例；回归门=core signatures 保持 0、renderer 落 255（=收一行桶）后归零、触碰文件过 prettier-guard --check --print-width 200。
裁决表落盘：docs/Iterations/p27-backlog/r7-renderer-triage.md（五类三列裁决表+规则层伪代码+fixture 实证记录+top 文件清单+15 处辅助重构清单+「不做的事」）。本轮未改任何源码；临时探针脚本/fixture 已清理。波 2 照表执行。
