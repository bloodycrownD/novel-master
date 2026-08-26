# 2026-08-21 protocol-merge A 线功能检（cr-func-A，readonly）

## 请求

对 `.woktree/pms`（分支 `feat/protocol-merge-agent-tool-mermaid-sharp`，基线 a17579e）做 A 线 readonly 功能小检：步骤矩阵 A1-A5 与 blocking 测试（T-PM1/2/3/5）对照、verify 证据覆盖、spec 偏离（SD-1 属 B 线不看）。

## 检查结论

- **矩阵**：A1-A5 全部落地。A1/A2 mapper 合并（tool_result/functionResponse 前置、相邻拼接、输出前最后一步、gemini 先合成 model turn 再合并、纯函数不落库）；A3 OpenAI 锁定用例；A4 删桥链路 core/desktop/mobile 逐文件清单与 diff 吻合；A5 存量用例内联 `"【done】"`、user-vfs-turn.service.test 删桥用例、vfs-flush spec 注记、CHANGELOG、allowlist 快照均到位。
- **残留 grep**：`TOOL_TURN_BRIDGE|appendToolTurnBridge|tool_turn_bridge` 仅余合法项——mobile composer 测试注释、存量 fixture（message-blocks / user-vfs-turn-view / normalize-for-llm-export 测试）、`normalize-for-llm-export.ts` 源码与 `message-metadata.ts` 类型联合（spec 红线 + PRD 不清洗存量）、dist 构建产物。无 IPC/UI 链路残留。
- **实测**：三 mapper 测试文件 tsx 实跑 27/27 通过，与 verify 摘要一致。
- **must-fix**：无。
- **观察项**：T-PM4（存量桥兼容，spec 标 blocking: yes）无专属新增用例，靠既有测试隐式覆盖（OpenAI 剔除空桥用例 + 存量 fixture）；desktop 删桥 UI 无专属断言（spec T-PM5 本就只安排 mobile 集成测试）。
- **func-ready: yes**。
