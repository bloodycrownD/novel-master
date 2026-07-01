# user ops 诊断日志采集说明

> 迭代：`mobile-user-ops-logging-project-workspace-back`  
> 过滤 tag：`[user-vfs-turn]`

## 启用条件

- **Debug 包**（Metro `__DEV__`）：默认启用。
- **Release 包**：默认关闭；需设置环境变量 `NM_USER_VFS_DIAG_LOG=1` 后重启 App。

## 采集命令

```bash
# Windows
adb logcat | findstr /i "user-vfs-turn"

# macOS / Linux
adb logcat | grep user-vfs-turn
```

## 复现步骤（edit 路径）

1. 打开 Android Debug 构建，进入某**会话**。
2. 从「聊天工作区」或文件列表打开**已有文件**（非新建）。
3. 修改内容 → 点击保存。
4. （可选）先**不发送**，确认 transcript 无 user ops 卡片。
5. 在 Composer **发送一条消息**（或符合条件的空续跑）。
6. 保存 logcat 输出。

## 事件解读

| 事件 | 说明 |
|------|------|
| `save_attempt` | FileEditor 触发保存（path、scopeKind、isDirty） |
| `save_map` | 映射结果：`kind` = `noop` / `edit` / `write`；含 `hunkCount`、`baselineLen`、`contentLen` |
| `save_skip_noop` | 映射为 noop，未调用 execute |
| `execute_start` / `execute_ok` | 工具已执行，pending 已追加（含 `pendingCount`） |
| `execute_fail` | 保存失败，无 pending |
| `flush_gate_skip` | 未进入 flush（flag 关或 runtime 无 userVfsTurn） |
| `flush_start` | 发送触发 flush，pending 非空 |
| `flush_diff` | 净 diff 摘要（各类型文件数、changed paths） |
| `flush_skip_empty_diff` | pending 有值但净 diff 空，pending 被清空，**无 transcript 卡片** |
| `flush_ok` | UA 两条已写入，transcript 应有 user ops 卡片 |

## 隐私

日志**不包含**文件正文、API Key、hunk old/new 全文；仅 path 与长度统计。
