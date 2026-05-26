# message-floor PRD

## 背景与变更动机

`message-visibility` 与 `nm message list` 原先直接展示数据库字段 **`seq`**（会话内单调插入序号）。删除消息后 `seq` 会出现空洞（如 1,3,5），与用户熟悉的酒馆式 **「楼层」**（连续 1,2,3…，与当前可见条数一致）不符。

**动机**：将 **floor（楼层）** 作为 CLI 展示与批量操作的坐标；**`seq` 保留为 Core 内部顺序与 `hideRange` 实现**，不在 DB 重排、不 compact。

## 范围变更说明（相对原 message-visibility）

| 维度 | 原需求 | 本变更 |
|------|--------|--------|
| `nm message list` 第二列 | 显示 `seq` | 显示 **`floor`**（1..n，按 `listBySession` 顺序） |
| 批量 hide/show | 仅 `--from-seq` / `--to-seq` | 增加 **`--from-floor` / `--to-floor`**（推荐） |
| Core / DB | — | **不变**（仍用 `seq`、`id`） |
| delete 后 seq | 不重排（既有行为） | **不变**；floor 在 list 时重算 |

**不包含**：

- Core `MessageService` / Repository API 变更
- delete 后 compact `seq`
- Mobile / Web UI
- 将 floor 持久化到数据库

## 影响模块与接口

| 模块 | 文件 | 变更 |
|------|------|------|
| CLI floor 映射 | `apps/cli/src/message/floor.ts` | 新增 `seqRangeFromFloors` |
| CLI message 命令 | `apps/cli/src/message/commands.ts` | list 输出 floor；hide/show 解析 floor→seq |
| CLI 测试 | `apps/cli/test/message-floor.test.ts` | 映射与校验用例 |
| Core | — | **无** |

**对外 CLI 行为**：

- `nm message list` → 列：`id \t floor \t role \t [H]? \t body`
- `nm message list --show-seq` → `id \t floor \t seq \t role \t …`
- `nm message hide|show --from-floor N --to-floor M` → 转为 `hideRange(fromSeq,toSeq)`
- `nm message hide|show --from-seq` / `--to-seq` → **保留**（脚本/调试）
- 单条仍用 `--message <id>`（不变）

## 验收标准

- [ ] `nm message list` 第二列为从 1 递增的 floor，与当前消息条数一致（无 seq 空洞展示）。
- [ ] Given 会话内 seq 为 1,3,5（中间已 delete），When `list`，Then floor 为 1,2,3。
- [ ] Given 同上列表，When `hide --from-floor 2 --to-floor 2`，Then 隐藏 seq=3 的消息（非 seq=2）。
- [ ] `--from-seq` / `--to-seq` 行为与变更前一致（按内部 seq 范围）。
- [ ] `--from-floor` 与 `--from-seq` **不可混用**；缺参时报错明确。
- [ ] `apps/cli` 中 `message-floor.test.ts` 通过；`npm run build`（cli）通过。

## 测试用例

1. **单元**：`seqRangeFromFloors([seq 1,3,7], 2, 3)` → `{ fromSeq:3, toSeq:7 }`。
2. **单元**：`from-floor > to-floor` → 抛错。
3. **手工**：append 3 条 → delete 第 2 条（按 floor 2 的 id）→ list 显示 floor 1,2 连续。
4. **手工**：`hide --from-floor 1 --to-floor 1` 后 list 见 `[H]`，floor 仍为 1..n。
5. **回归**：`hide --from-seq` 在已知 seq 的会话上仍生效。
