---
createdAt: '2026-05-25 00:45:47'
updatedAt: '2026-06-18 00:36:17'
---
# vfs-flush-insert-after-assistant 轮次 2 完成

## 状态
merge-ready

## HEAD
5953bd38

## 提交
- 8e34415e fix(ui): VFS 工具卡片 flush 后显示成功
- d8dbcc8b fix(core): 空续跑时 VFS flush 插在末条 assistant 之后
- b27b8662 fix(core): pending 非空才重排末条 user，flush 失败时恢复
- 5953bd38 test(core): 补充 F2/F3/F4 与 flush 失败恢复用例

## 验证
core run-agent-turn|user-vfs-turn + mobile message-blocks + npm run build