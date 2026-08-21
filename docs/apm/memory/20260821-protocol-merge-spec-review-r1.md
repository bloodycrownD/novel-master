---
date: 2026-08-22 00:10
title: 三合一迭代 spec 评审与合并记录
keywords: spec-check-loop, execute-ready, 烘焙钳制, 删桥清单, agents 闭包, --no-ff 合并
abstract: protocol-merge-agent-tool-mermaid-sharp 的 spec 两轮评审达 execute-ready（7 条 must-fix 闭合 + 2 条 trivial 豁免），worktree 分支 18 笔 --no-ff 合入主仓 feat/pms-integration（26a6f90）。
---

user:
（@spec-check-loop）审查三合一迭代 `docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/` 的 PRD/SPEC 是否 execute-ready。

assistant:
第 1 轮 fix 要点（证据均已在主仓实证核对）：
- **P0-1 烘焙方案**：`mermaid-fullscreen-styles.ts` 的 `svg { max-width:100%; max-height:100% }` 会把烘焙 px 钳回 viewport 盒；fit 态基准渲染尺寸 = fitRatio × viewBox（非盒、非 viewBox 原值）；pan clamp 旧公式 `viewport*(scale-1)/2` 在烘焙归一 scale=1 后退化为 0。SPEC 改为烘焙同步置 maxWidth/maxHeight='none' + `computeBakedSvgSize(baseRendered, scale)` + clamp 公式 `max(0,(contentRendered-stage)/2)`。
- **P1-1 删桥清单**：双端 runtime types+factory 在 `src/runtime/` 而非 `src/services/`；workplace-done 系用例断言的是 prompt 机制，改法是 `TOOL_TURN_BRIDGE_TEXT` import 内联字面量。
- **P1-2 agents 闭包**：toolsFromRegistry 的 description 同步求值（tool-definitions.ts L25）而 agentRegistry.list() 返 Promise——装配期预算快照（主装配点复用 allDefs、runChildAgent 复用 childAllDefs）。
- **P2**：summarizeToolSuccess 在 core `build-tool-result-block.ts` L54；计数硬编码不止 mobile AgentEditorForm，desktop 两处也要；ToolPolicyPicker 走 catalog.length 自动适应。
grep 注意：`.woktree/*` 工作树按字母序排前会刷屏，要翻页或直读主树文件确认。
第 2 轮复审：7 条 must-fix 全部对照代码实证闭合，结论 Go（execute-ready）；余 2 条 P2 由主代理 trivial 豁免直接闭合——①A5 补更新 `packages/core/test/package-exports/snapshots/public-chat-allowlist.json`（移除 TOOL_TURN_BRIDGE_TEXT，否则导出快照失配）；②C1/T-MS1 明确 contentRendered = 视觉尺寸（布局 × gesture.scale），手势中与烘焙后两态各一条 clamp 用例。

user:
继续干吧（实现完成后合并回主仓）。

assistant:
合并记录：worktree 分支 feat/protocol-merge-agent-tool-mermaid-sharp（398860d，18 笔）已 --no-ff 合入主仓 feat/pms-integration（26a6f90，基于 main 409ceca），72 文件 +2517/-325。合并前处理：主仓未跟踪的 7 个原始文档副本（与分支同源，spec.md 分支版多实现注为新版）移除后合并；.gitignore 经 checkout 恢复后由合并带回；主仓用户未提交改动（AGENTS.md、.vscode 删除）未受影响。注意主仓 dist/webview-dist 为旧产物，验证新行为前需重建（core `npm run build` + mobile `npm run build:webview`，或走各端 dev 流程）。
