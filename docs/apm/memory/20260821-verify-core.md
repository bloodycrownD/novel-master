# protocol-merge 迭代 core 整体验证（verify-core）

- 日期：2026-08-21；worktree `.woktree/pms`，分支 `feat/protocol-merge-agent-tool-mermaid-sharp`，HEAD 7f950c1。
- 任务：A 线 mapper 合并 + B 线 agent 工具在 core 的改动做整体验证（typecheck + 全量测试），只记录不修复。

## 结果

- `npm run typecheck`：通过（无输出）。
- `npm run build`：通过（测试夹具依赖 dist，先构建）。
- 全量测试 `npx tsx --experimental-test-module-mocks --tsconfig tsconfig.test.json --test "test/**/*.test.ts"`：2078 条，2077 过 / 1 败（44.9s）。

## 失败明细与归因

- `P2: rollback diff 1000 files P95 within threshold`（`test/message-checkpoint/performance.test.ts:119`）：`rollback P95 6064.6ms exceeds 3000ms`。
- 归因：存量问题，与本迭代无关。依据：
  1. 本迭代 core 改动清单（`git diff main...HEAD -- packages/core`，30 个文件）不含任何 message-checkpoint 路径。
  2. 该文件被包自身 `npm test` script 显式排除（`test/**/!(performance).test.ts`），本迭代全量命令多跑了它。
  3. 单独重跑该文件 2/2 通过——失败仅在 2078 条并发满负载下出现，属性能阈值时序抖动。

## 环境备注

- core 的 `npm test` script 在 sh（dash）下直接炸 `Syntax error: "(" unexpected`：`!(performance)` 是 bash 扩展通配符，npm script-shell 默认 sh 展不开（存量问题）。全量测试需按上面命令显式引号传 glob 给 node test runner。
