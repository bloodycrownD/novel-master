---
date: 2026-07-10
---

# Desktop IPC Hop 必要性说明

> 迭代：[prd.md](./prd.md) · [spec.md](./spec.md)  
> 原则：**保留必要 hop，收敛偶然 hop**（编排收敛 C-orch）

## 保留的 hop（不可拆除）

| Hop | 路径 | 原因 |
|-----|------|------|
| Preload 桥接 | renderer → `contextBridge` → preload → `ipcRenderer` | Electron 沙箱：`contextIsolation` + `nodeIntegration: false`；renderer 禁止直连 Node / SQLite / Core |
| Main invoke | preload → `ipcMain.handle` → handler → Core service | 唯一受信边界；DB、VFS、Agent run 均在 main 进程 |
| Event 推送 | Core `eventBus` → main 订阅 → `webContents.send` → preload `on` → renderer | 流式 delta 与 run 生命周期须 main 转发；renderer 不能订阅 Core bus |
| Agent stream 合批 | renderer `useAgentStream` 32ms/64ms buffer | 降低 React 重绘频率；属 UI 层策略，非 IPC 跳数 |
| `agentActive` refcount | main `handlers/agent.ts` 增减 → `nm:agent/activity` 推送 | 工具卡「执行中」与 Cloud Sync 门禁需跨组件一致；Desktop **不在 renderer decrement** |

## 已收敛的 hop / 样板

| 项 | 收敛前 | 收敛后 |
|----|--------|--------|
| 死通道 `nm:event-bus` | `IPC_CHANNELS.EVENT_BUS` 无实现 | **已删除**（M5 Step 27） |
| `forward-event-bus` 副作用 | 转发时调用 `onCoreRun*` 登记 run | **纯 `webContents.send`**；run 登记迁至 `attachAgentRunLifecycleListeners`（M5 Step 28） |
| handler / client 同质封装 | ~100 对 `ipcMain.handle` + `bridge().invoke` 手写 | **`invoke-registry` 映射表**（M5 Step 29） |
| 10 份 handler 本地 `formatError` | 各 handler 重复 unwrap | 统一 `formatIpcError`（M4 Step 25） |
| `agent-event-types.ts` 手改 | 与 core `event-types.ts` 漂移风险 | 构建脚本 `generate:desktop-events` 从 core 生成（M5 Step 30，可选） |

## invoke 跳数（不变）

典型 Agent 运行仍为 **6 跳**（renderer composable → client → preload → main handler → `runAgentTurn` → Core runner）。本迭代**不减少跳数**，只减少登记分散与重复样板。

## 维护者检查清单

- 新增 IPC：**先**在 `shared/ipc-types.ts` 增 channel + DTO，**再**在 `invoke-registry` / `handler-registry` 各增一行。
- 禁止在 renderer 直接 import Core runtime / DB。
- run 生命周期（`activeRuns`、`agentActive`）仅在 `handlers/agent.ts` + `attachAgentRunLifecycleListeners` 维护；`forward-event-bus.ts` 不得再含 run 副作用。
