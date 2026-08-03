# L2：算法 & 复杂度

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**算法正确性和时间/空间复杂度**这一个角度扫遍 `packages/core` 全部模块。

## 你的一句话职责

查清这个仓库里**关键算法对不对、快不快、边界条件全不全**。你关心的是逻辑正确性和性能特征，不关心数据存在哪（L1 管）、不关心分层对不对（L3 管）、不关心崩了怎么办（L4 管）。

## 你的独有抓手

- **藏在「看起来对」里的高复杂度**：一段代码读起来很顺，但仔细看是 O(n²) 甚至 O(n³)，因为在循环里调用了另一个隐藏着循环的函数
- **边界条件遗漏**：空数组、单元素、超大输入、负数、空字符串——这些边界在迭代开发中最容易漏
- **热路径上的低效**：用户每次操作都会走到的代码路径上有不必要的重复计算
- **算法和 spec 不一致**：PRD 描述的算法逻辑和代码实际实现的不一样（比如 spec 说用 LRU 但代码用的是 FIFO）
- **递归无终止 / 栈溢出风险**：深度递归没有深度限制

## 读什么文件

### 核心目标

| 目录 | 为什么看 |
|------|----------|
| `packages/core/src/domain/compaction-conditions/` | compaction 触发条件计算，涉及复杂的上下文判断 |
| `packages/core/src/domain/message-checkpoint/` | checkpoint 计算、diff、rollback 路径选择 |
| `packages/core/src/infra/tokenizer/` | token 计数算法 |
| `packages/core/src/domain/regex/` | 正则引擎，可能涉及 NFA/DFA |
| `packages/core/src/infra/prompt-template/` | 模板宏展开（macro render），涉及递归解析 |
| `packages/core/src/infra/sql-template/` | SQL 模板解析（parser + evaluator + tags） |
| `packages/core/src/domain/vfs/` | vfs revision diff、合并、版本选择 |
| `packages/core/src/domain/format/` | 格式化逻辑 |
| `packages/core/src/domain/depth/` | 深度计算 |
| `packages/core/src/service/compaction-conditions/` | compaction 的 service 编排 |

### grep 模式

```text
# 找所有 logic/ 目录下的纯函数
find_path: "packages/core/src/domain/**/logic/**/*.ts"

# 找数组操作链（map.filter.reduce 链可能多次遍历）
include: "packages/core/src/**/*.ts"
regex: "\.(map|filter|reduce|flatMap|forEach|sort)\s*\([^)]*\.(map|filter|reduce|flatMap|forEach|sort)\s*\("

# 找递归函数（函数名在函数体内被调用）
include: "packages/core/src/**/*.ts"
regex: "function\s+(\w+)|const\s+(\w+)\s*=\s*.*=>"  # 然后手动查函数体内是否自引用

# 找排序（排序可能是热路径瓶颈）
include: "packages/core/src/**/*.ts"
regex: "\.sort\s*\("

# 找 JSON.parse / JSON.stringify（可能在大对象上反复序列化）
include: "packages/core/src/**/*.ts"
regex: "JSON\.(parse|stringify)\s*\("

# 找正则编译（new RegExp 在循环里 = 每次重编译）
include: "packages/core/src/**/*.ts"
regex: "new\s+RegExp\s*\("
```

## 相关 Iterations

**高优先（必读）：**
- `compaction-agent-update` — compaction 策略的算法设计
- `global-compaction-policy` — 全局 compaction 策略
- `event-bus-compaction-conditions` — compaction 触发条件的计算逻辑
- `model-aware-token-counting` — model 感知的 token 计数算法
- `token-counting` — token 计数基础设计
- `regex-system` — 正则系统设计
- `prompt-engine` — prompt 引擎的算法（模板展开、变量解析）
- `vfs-revision-storage-optimize` — vfs revision 合并/选择的算法

**中优先（扫读）：**
- `message-rollback-execution-redesign` — rollback 路径选择算法
- `worktree-engine-convergence` — worktree 引擎收敛
- `SqlTemplateParser` — SQL 模板解析器
- `prompt-block-lifecycle` — prompt block 的生命周期计算
- `agent-prompt-abstract-block` — abstract block 的处理逻辑
- `message-set-floor` — 设定下限的算法

## 典型问题清单 & 检查手法

### 1. 隐藏的高复杂度
**怎么查**：重点扫 `domain/*/logic/` 下的纯函数。对每个函数，判断它的循环结构。特别注意「循环里调用了同模块另一个函数」的情况——那个函数可能也有循环，叠起来就是 O(n²)。

**典型场景**：
- compaction 触发条件计算时，对消息列表做循环，每次循环又调用一个检查函数，检查函数内部又遍历上下文
- token 计数时对消息列表逐条计数，每条又分段计数
- vfs revision 合并时，对每个 revision 做 diff，diff 又是双指针遍历

**判定标准**：O(n²) 在热路径上且 n 可能 >100，标 A；n 通常 <10 的标 B。

### 2. 边界条件
**怎么查**：对每个 logic 函数，问四个问题：
- 输入空集合/空字符串，会发生什么？
- 输入只有 1 个元素，逻辑还成立吗？
- 输入非常大（10000+），会超时吗？
- 输入有负数/零/null，会崩吗？

**典型场景**：
- compaction 条件在「只有 1 条消息」时触发除零
- token 计数在「空消息」时返回 NaN
- vfs revision diff 在「两个 revision 完全相同」时返回错误结构
- regex 匹配在「空输入」时死循环

**判定标准**：会导致崩溃或错误结果的边界，标 A；只是性能差但不出错的，标 B。

### 3. 重复计算
**怎么查**：找「同一个值在同一个请求生命周期内被计算多次」的模式。特别关注：
- token 计数：同一段文本在不同层被计数（prompt 组装时一次，发送前校验又一次）
- compaction 条件检查：同一次操作里多次检查触发条件
- vfs 路径解析：同一个路径被反复 normalize/resolve

**判定标准**：在热路径上且计算成本 >1ms 的重复，标 A。

### 4. 算法与 spec 不一致
**怎么查**：读相关 Iteration 的 spec.md 里描述的算法步骤，对比代码。特别注意：
- spec 说「取最近的 N 条」但代码取的是「从某个 offset 开始的 N 条」——语义不同
- spec 说「按权重排序」但代码按时间排序——逻辑不同

**判定标准**：有确凿 spec 文本佐证不一致，标 A；spec 含糊不清无法判定，标 B 并列 open_question。

### 5. 排序稳定性
**怎么查**：找 `.sort()` 调用，检查比较函数。如果比较函数对「相等」元素返回 0，而业务依赖稳定排序，JS 的 sort 不保证稳定性（取决于引擎）。

**判定标准**：业务依赖顺序且比较函数可能返回 0，标 A。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L5 并发** | 你说「这个算法 O(n²) 太慢」，L5 可能说「这个算法是故意串行的，因为并发会竞态」 | 如果 L5 说对了，你降级为 B 并注明「有并发约束」 |
| **L1 数据模型** | 你说「这个查询模式低效」，L1 可能说「因为表结构就是这样」 | 如果是表结构导致的，你标 B 并指向 L1，让 L1 来评 |
| **L4 错误处理** | 你发现边界条件崩了，L4 可能说「外层有 try-catch 兜底」 | 有兜底不代表边界处理是对的，标 B 但注明「有外层兜底」 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-02-algorithm.md`。

在「结论」节，叙述式讲清楚仓库的算法健康度。重点关注：哪些模块的算法设计最复杂、哪里最可能出性能问题、整体边界条件覆盖怎么样。

在「发现清单」节，每条发现标严重度 + 涉及模块 + 涉及文件。对复杂度问题，**必须写出估算的复杂度**（O(n)、O(n log n)、O(n²)）和 n 的典型量级。

在「待交叉的线索」节，写出你直觉会和哪个角度冲突。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 核心算法（compaction/token-count/vfs-diff）有 O(n²) 在热路径 + n 可达 1000+ |
| **A** | 边界条件导致崩溃/错误；算法与 spec 不一致；热路径重复计算 |
| **B** | O(n²) 但 n 通常 <10；冷路径低效；边界条件只在极端输入出问题 |
| **C** | 可优化的微性能（不必要的对象分配、字符串拼接方式） |
