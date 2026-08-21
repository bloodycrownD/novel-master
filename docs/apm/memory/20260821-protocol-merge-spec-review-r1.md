# protocol-merge-agent-tool-mermaid-sharp SPEC 评审第 1 轮 fix

- 日期：2026-08-21
- 范围：只改 PRD/SPEC 文档（`docs/Iterations/protocol-merge-agent-tool-mermaid-sharp/`），不改实现代码
- 修复：spec 全部 must-fix（P0-1、P1-1~3、P2-1~3）

## 关键结论（证据均已在主仓库抽查核实）

- **P0-1 烘焙方案**：`mermaid-fullscreen-styles.ts` L28 的 `svg { max-width:100%; max-height:100% }` 会把烘焙 px 钳回 viewport 盒；`MermaidViewerOverlay.tsx` fit 态是 width/height 100% + preserveAspectRatio meet（基准渲染尺寸 = fitRatio × viewBox，非 viewBox 原始值）；pan clamp 旧公式 `viewport*(scale-1)/2` 在烘焙归一 scale=1 后退化为 0。SPEC D8/C1/C2 已改为：烘焙同步置 `svg.style.maxWidth/maxHeight='none'`、`computeBakedSvgSize(baseRendered, scale)`、clamp 公式 `max(0,(contentRendered-stage)/2)`。
- **P1-1 删桥清单**：主仓库全量引用已核（core public/chat.ts L323/334 re-export、desktop shared/logic/chat.ts、ipc-types.ts、renderer ipc client/invoke-registry、main ipc handler-registry/handlers/messages、双端 runtime types+factory 在 `src/runtime/` 而非 `src/services/`）。注意：grep 时 `.woktree/*` 工作树会刷屏（按字母序排前），要翻页或直读主树文件确认。7 处测试引用里，workplace-done 双消息系列用例断言的是 prompt 机制不是桥本身，改法是 `TOOL_TURN_BRIDGE_TEXT` import 内联为 `"【done】"` 字面量。
- **P1-2 agents 闭包**：`toolsFromRegistry` 的 description 同步求值（tool-definitions.ts L25），`agentRegistry.list()` 返回 Promise；`BuiltinToolAgentsContext.agents` 装配期预算快照（主装配点复用 `allDefs`、runChildAgent 复用 `childAllDefs`）。
- **P1-3 mapper 测试**：`packages/core/test/infra/llm-protocol/` 下 gemini/openai-content-mapper.test.ts 已存在、anthropic 不存在（新建）。
- **P2-2 归属**：`summarizeToolSuccess` 在 `packages/core/src/domain/tool/logic/build-tool-result-block.ts` L54（core）；计数硬编码仅 mobile `AgentEditorForm.tsx` L882；双端 ToolPolicyPicker 走 `BUILTIN_TOOL_CATALOG.length` 自动适应无需改。
- PRD 仅同步一句（核心需求 10 烘焙公式改为 fit 基准渲染尺寸 × scale）；验收 1/7 的用例映射由新增 T-PM5 与 T-AG4 deny 路径补齐。

## 第 2 轮复审（同日）

- 7 条 must-fix 全部对照代码实证闭合（D8 三件套按到 mermaid-fullscreen-styles.ts L28 / gestures L47-48 / Overlay L197-201 验证；A4 逐文件命中；B2 allDefs L415/childAllDefs L615 数据可得）。
- 结论 Go（execute-ready）。余 2 条 P2 由主代理 trivial 豁免直接闭合：①A5 补更新 `packages/core/test/package-exports/snapshots/public-chat-allowlist.json`（移除 TOOL_TURN_BRIDGE_TEXT，否则导出快照失配）；②C1/T-MS1 明确 contentRendered = 视觉尺寸（布局 × gesture.scale），手势中与烘焙后两态各一条 clamp 用例。
- 状态：execute-ready 达成，待用户确认后按 spec 开工（Step A1-A5 / B1-B4 / C1-C4）。
