# L4：错误处理 & 事务

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**错误处理、事务边界、部分失败恢复**这一个角度扫遍 `packages/core` 全部模块。

## 你的一句话职责

查清这个仓库里**错误有没有被正确处理、多步操作有没有事务保护、部分失败了能不能回滚**。你最关心的不是「正常路径对不对」，而是「出了岔子之后会怎样」。

## 你的独有抓手

- **catch 吞错误**：`catch (e) { /* 空 */ }` 或 `catch (e) { return null }`——错误被静默吃掉，上层完全不知道出了问题
- **多步写无事务**：一个操作要写两张表或两个文件，中间崩了就产生脏数据
- **事务边界不对**：有事务，但边界太窄（没覆盖全部写操作）或太宽（把无关操作包进来导致锁竞争）
- **回滚不完整**：rollback 逻辑只回滚了一部分步骤，留下半成品状态
- **资源泄漏**：打开的 file handle、database connection、event listener 在错误路径上没被释放
- **错误类型语义混乱**：catch 了 Error 但不区分类型，或者 throw 了 string 而不是 Error 子类
- **finally 缺失**：需要清理资源的操作没有 finally 块

## 读什么文件

### 核心目标

| 目录 | 为什么看 |
|------|----------|
| `packages/core/src/domain/message-checkpoint/` | checkpoint 创建、rollback——最关键的事务场景 |
| `packages/core/src/service/message-checkpoint/` | checkpoint service 编排 |
| `packages/core/src/domain/vfs/` | vfs 写入、revision 创建——文件系统事务 |
| `packages/core/src/service/vfs/` | vfs service |
| `packages/core/src/domain/chat/` | 消息发送、保存——多步写 |
| `packages/core/src/service/chat/` | chat service 编排 |
| `packages/core/src/domain/agent/` | agent 操作 |
| `packages/core/src/errors/` | 错误类型定义 |
| `packages/core/src/infra/tdbc/` | 数据库连接管理（事务的基础） |
| `packages/core/src/domain/*/repositories/impl/` | SQL 写操作（看有没有用事务） |

### grep 模式

```text
# 空 catch（吞错误）
include: "packages/core/src/**/*.ts"
regex: "catch\s*\([^)]*\)\s*\{\s*(\}|return|\/\/|console)"

# 所有 throw
include: "packages/core/src/**/*.ts"
regex: "throw\s+"

# throw string（不是 Error 对象）
include: "packages/core/src/**/*.ts"
regex: "throw\s+['\"]"

# 事务相关
include: "packages/core/src/**/*.ts"
regex: "transaction|\.tx\b|BEGIN|COMMIT|ROLLBACK|rollback"

# try-finally（有清理） vs try-catch（无 finally 可能漏清理）
include: "packages/core/src/**/*.ts"
regex: "try\s*\{"

# resource 管理（打开/关闭模式）
include: "packages/core/src/**/*.ts"
regex: "\.open\s*\(|\.close\s*\(|connect\s*\(|disconnect\s*\(|acquire\s*\(|release\s*\("

# 事件监听器（可能漏移除）
include: "packages/core/src/**/*.ts"
regex: "\.addEventListener\s*\(|\.on\s*\(|\.addListener\s*\("

# 特意搜 rollback 相关
include: "packages/core/src/**/*.ts"
regex: "rollback|undo|revert|compensate"
```

## 相关 Iterations

**高优先（必读）：**
- `message-rollback-execution-redesign` — rollback 执行的重设计，最核心
- `rollback-failure-degraded-fallback` — rollback 失败后的降级
- `rollback-import-baseline-checkpoint` — 导入基线 checkpoint
- `rollback-mkdir-idempotent` — rollback 的 mkdir 幂等
- `rollback-revision-head-backfill` — revision head 回填
- `message-rollback-remove-session-log` — 移除 session log
- `message-checkpoint-v2` — checkpoint v2 设计
- `agent-resilience-mobile-yaml` — agent 韧性
- `vfs-tool-error-diagnostics` — vfs 工具错误诊断

**中优先（扫读）：**
- `mobile-sse-stream-resilience` — SSE 流韧性
- `mobile-stability-db-migration` — DB migration 稳定性
- `mobile-chat-stability-fixes` — chat 稳定性
- `agent-chat-ux-bugfix` — agent chat bug 修复
- `chat-rollback-vfs-tool-fixes` — rollback + vfs 工具修复
- `chat-send-render-refactor` — 发送渲染重构
- `import-export-navigation-fix` — 导入导出（多步写）

## 典型问题清单 & 检查手法

### 1. catch 吞错误
**怎么查**：grep 所有 catch 块。对每个 catch，检查：
- catch 体是空的或只有注释 → 吞错误
- catch 体只 return null/undefined/false → 静默失败
- catch 体只有 console.log/console.error → 记了日志但没上报
- catch 体 throw 了但 throw 的是 string 或非 Error → 错误类型信息丢失

**判定标准**：空 catch 或静默 return 在**涉及持久化/外部调用的路径**上，标 A；在纯 UI 路径，标 B。

### 2. 多步写无事务
**怎么查**：在 service 层找「一个方法里调用了多个 repo 写操作」的模式。比如：
```typescript
async saveMessage() {
  await this.messageRepo.insert(...)   // 步骤1
  await this.checkpointRepo.insert(...) // 步骤2
  await this.vfsRepo.update(...)        // 步骤3
  // 如果步骤2崩了，步骤1已经写进去了——脏数据
}
```

**判定标准**：多步写且无事务包裹，标 A；有事务但边界不完整，标 A。

### 3. 回滚不完整
**怎么查**：读 `message-rollback-execution-redesign` 的 spec 理解完整 rollback 步骤，然后对比代码。检查：
- rollback 逻辑是否覆盖了所有被修改的状态（DB、文件、内存缓存）
- rollback 自身失败后有没有补偿机制（参考 `rollback-failure-degraded-fallback`）
- rollback 是否幂等（参考 `rollback-mkdir-idempotent`）

**判定标准**：rollback 步骤缺失（遗漏某个状态），标 A；rollback 自身可能失败但无补偿，标 A。

### 4. 资源泄漏
**怎么查**：找「打开资源 → 使用 → 关闭」模式。检查：
- 有 try-finally 保证关闭吗？
- 如果 try 块在打开资源之前就 throw 了，finally 会不会对 null/undefined 调用 close？
- 错误路径（catch 之后）是否也正确关闭了资源？

**典型场景**：
- TDBC connection 打开后如果 query 失败，连接是否释放？
- 文件 handle 打开后如果写入失败，是否关闭？

**判定标准**：有泄漏路径（错误路径上不释放），标 A；正常路径释放但错误路径可能漏，标 A。

### 5. 错误类型体系
**怎么查**：读 `packages/core/src/errors/` 下的所有错误类。检查：
- 业务错误（用户可见）和技术错误（内部故障）有没有区分？
- catch 块是否区分错误类型，还是一律当 Error 处理？
- 是否有「catch Error → throw 新 Error」丢失原始堆栈的模式？

**判定标准**：业务/技术错误不分，标 B；丢失原始堆栈的 rethrow，标 A。

### 6. AbortController / 流取消的清理
**怎么查**：找 AbortController 使用的地方。检查：
- abort 后正在进行的操作是否正确终止？
- abort 后 partial 结果是否被正确处理（丢弃 vs 保留）？
- abort 触发的 error 是否被正确分类（不是 bug 而是用户取消）？

**判定标准**：abort 后 partial 结果污染了正常状态，标 A。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L1 数据模型** | 你说「多步写没事务」，L1 可能说「schema 设计上不需要事务」 | 如果 schema 层面保证了原子性（比如单表写入），你降为 B；否则坚持 A |
| **L5 并发** | 你说「rollback 不完整」，L5 可能说「这里不会有并发，串行执行」 | 没有并发不代表不需要完整 rollback——崩溃（非并发）也会导致中间状态 |
| **L2 算法** | 你说「边界条件崩了」，L2 也在查同一个 | 你关注「崩了之后怎么办」，L2 关注「为什么会崩」——两条都记，交叉点 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-04-error-txn.md`。

在「结论」节，叙述式讲清楚：这个仓库的错误处理文化是什么样的——是「快速失败」还是「尽力恢复」？事务边界整体画得对不对？rollback 逻辑可信吗？

**特别要求**：你的报告必须包含一张**事务/回滚路径表**——每个涉及多步写的操作，列出：操作名 | 涉及步骤 | 有无事务 | rollback 覆盖度。这张表会被 phase2 模块切片反复引用。

在「待交叉的线索」节，标出哪些多步写你可能和 L1（数据模型）或 L5（并发）有分歧。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 多步写在热路径上完全无事务且涉及用户数据（消息/vfs） |
| **A** | catch 吞错误；rollback 步骤缺失；资源泄漏；多步写无事务 |
| **B** | 错误类型不分；finally 缺失但资源在别处释放；边界 catch 不完整 |
| **C** | console.log 代替正式错误上报；注释里的 TODO 修复项 |
