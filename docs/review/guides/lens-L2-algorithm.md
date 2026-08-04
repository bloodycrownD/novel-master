# L2：算法 & 复杂度

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**算法正确性、时间/空间复杂度、构建时复杂度**这一个角度扫遍整个仓库。L2 不只看运行时算法，也看构建管线的复杂度与重复劳动——因为「构建慢」和「算法慢」一样会拖垮迭代效率，且常常是工程化层面被忽视的隐性成本。

## 你的一句话职责

查清这个仓库里**关键算法对不对、快不快、边界条件全不全**，外加**构建管线有没有浪费的重复劳动**。运行时这边你关心逻辑正确性和性能特征，不关心数据存在哪（L1 管）、不关心分层对不对（L3 管）、不关心崩了怎么办（L4 管）。构建时那边你关心的是 tsc/vite/Metro 这几套管线有没有冗余、有没有禁用增量编译、prebuild 链是不是在反复构建同一个产物——这些虽然不直接是「算法」，但本质上是「工程化层面的复杂度与重复计算」，归你管。

## 你的独有抓手

- **藏在「看起来对」里的高复杂度**：一段代码读起来很顺，但仔细看是 O(n²) 甚至 O(n³)，因为在循环里调用了另一个隐藏着循环的函数
- **边界条件遗漏**：空数组、单元素、超大输入、负数、空字符串——这些边界在迭代开发中最容易漏
- **热路径上的低效**：用户每次操作都会走到的代码路径上有不必要的重复计算
- **算法和 spec 不一致**：PRD 描述的算法逻辑和代码实际实现的不一样（比如 spec 说用 LRU 但代码用的是 FIFO）
- **递归无终止 / 栈溢出风险**：深度递归没有深度限制

## Phase 0 已确认的算法热点

Phase 0 侦察已定位了代码量和引用密度，**这些是算法复杂度的重灾区**：

### 「小代码大复杂度」极端案例

**compaction-conditions**：domain 195 行 + service 217 行 = 412 行，但 5 个迭代全在调触发逻辑。这说明触发条件的算法语义复杂度远超代码长度——每次迭代都是架构层级的调整（从 agent 内置 → 全局策略 → 事件总线驱动）。重点查：触发条件的组合爆炸、边界情况（只有 1 条消息、超出阈值、并发触发）。

### 已知 god module（复杂度热点）

- **`vfs-path-mapper`（42 次引用）**：路径解析/映射是 vfs 的中心枢纽，被几乎所有 vfs 文件引用。算法重点：路径规范化、resolve、join 的复杂度，以及重复计算（同一路径被反复 normalize）。
- **`agent-prompt-layout`（19 次引用）**：prompt 布局组装，涉及多区块合并。
- **`depth-slice`（18 次引用）**：深度切片计算。

### 测试极稀的算法区（复杂度风险商）

- **regex**：727 行 domain + 287 service，只有 3 个测试——正则引擎算法几乎无测试保护
- **vfs revision**：revision diff/合并算法，vfs 总体只有 31 测试覆盖 5512 行
- **prompt-engine**：模板宏展开（递归解析），prompt 只有 13 测试覆盖 1006 行

### 迁移脚本中的算法痕迹

- `vfs-revision-ref-count-v1`：revision 引用计数——意味着 revision 合并/清理算法有计数逻辑
- `vfs-content-blob-zlib-v1`：content blob 压缩——意味着有压缩/解压算法

## 读什么文件

### 核心目标

| 目录 | 为什么看 |
|------|----------|
| **`packages/core/src/domain/compaction-conditions/`** | **重点**——412 行但 5 迭代，触发条件算法 |
| `packages/core/src/domain/vfs/logic/` | vfs-path-mapper + revision diff 算法 |
| `packages/core/src/domain/regex/` | 正则引擎（727 行但只有 3 测试） |
| `packages/core/src/infra/tokenizer/` | token 计数算法 |
| `packages/core/src/infra/prompt-template/` | 模板宏展开（递归解析） |
| `packages/core/src/infra/sql-template/` | SQL 模板 parser + evaluator + tags（938 行） |
| `packages/core/src/domain/message-checkpoint/` | checkpoint diff 算法 |
| `packages/core/src/domain/format/` | 格式化逻辑 |
| `packages/core/src/domain/depth/` | 深度计算 |
| `packages/core/src/service/compaction-conditions/` | compaction 编排 |

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

## 构建时复杂度（扩展维度）

运行时算法之外，L2 还要查**构建管线的复杂度**。这个仓库有三套构建管线并存（tsc-alias / vite+esbuild / Metro+webview），每套都有自己的缓存和增量策略，叠起来很容易出现「同一段代码被反复编译」的情况。这一节的目的是把构建层面的隐性成本挖出来，和运行时复杂度一起算总账。

### Phase 0 已确认的构建现实

- **core 构建禁用增量**：`packages/core/package.json` 的 build 脚本是 `tsc --build tsconfig.json --force`——`--force` 会无视 `.tsbuildinfo`，每次全量重编。这意味着 core 任何一个改动都会触发完整重编，而不是只重编受影响的下游项目。
- **三套构建管线并存**：core 用 `tsc-alias`（tsc 编译 + 路径别名重写）；desktop 用 `vite + esbuild`（dev 用 esbuild，build 用 rollup）；mobile 用 Metro + rn-webview（RN 打包 + webview 容器）。三套管线的 source map、tree-shaking、watch 模式都不互通。
- **prebuild 链冗余嫌疑**：mobile 的 `prebuild` 链涉及多个 npm script 串联（`clean` → `build:core` → `build:webview` → ...），如果每一环都重新触发 core 的 `--force` 构建，整个 prebuild 就会反复编译 core。
- **TS 项目引用未利用增量**：core 的 `tsconfig.json` 配了 `composite: true`，但 build 脚本用 `--force` 把增量优势抵消了。`tsbuildinfo` 文件虽然在，却没发挥作用。

### 构建维度怎么查

| 查什么 | 怎么查 | 判定 |
|--------|--------|------|
| **`--force` 是否必要** | 读 `packages/core/package.json` 的 scripts，确认 `--force` 是历史遗留还是有意为之（比如为了规避某个增量编译 bug） | 无明确理由的 `--force`，标 A |
| **prebuild 链是否重复构建 core** | 读 `apps/mobile/package.json` 的 `prebuild` 脚本链，看每一环是否都调了 `build:core`；读根 `package.json` 看有没有 orchestrator | 同一产物在 prebuild 链中被构建 ≥2 次，标 A |
| **三套管线的缓存策略** | core 的 `.tsbuildinfo`、desktop 的 vite 缓存（`node_modules/.vite`）、mobile 的 Metro cache——三者是否各自独立、有没有共享可能性 | 缓存完全独立且重复编译相同源码，标 B |
| **watch 模式覆盖** | 哪些包提供了 `dev` / `watch` 脚本，哪些只能 `build` 一次性的。开发者改 core 后，三端是否需要手动重编 | 端侧无 watch 且依赖 core 改动，标 B |
| **monorepo.md 承诺的脚本缺失** | 读 `docs/monorepo.md` 看它列了哪些 `vfs:watch` / `vfs:push` 之类脚本，再去根 package.json 核对是否存在 | 文档承诺但脚本不存在，标 B 并指向 L11 |

### 构建维度的 grep / 文件读取

```text
# 找所有 build / prebuild / postbuild 脚本（看脚本链是否有冗余）
include: "**/package.json"
regex: "\"(build|prebuild|postbuild|dev|watch|clean)\":\s*\""

# 找 --force 标志（禁用增量的嫌疑点）
include: "**/package.json"
regex: "--force"

# 找 tsbuildinfo 引用（确认 composite 项目引用关系）
include: "**/tsconfig*.json"
regex: "references|composite|tsBuildInfoFile"

# 找 tsc-alias / vite / Metro 配置文件
find_path: "**/{tsconfig*.json,vite.config.*,metro.config.*,babel.config.*}"
```

### 与其他角度在构建维度上的分工

构建复杂度是个跨界话题，L2 只负责「重复劳动和增量失效」这一面，别越界：

- **L3 看依赖图**：包与包之间的依赖方向对不对、有没有循环依赖——那是架构问题，归 L3。L2 不管包依赖，只管编译管线。
- **L10 看基建一致性**：CI 配置、lint 规则、tsconfig 选项是否统一——那是工程化纪律，归 L10。L2 只在 tsconfig 选项直接影响增量编译时才过问（比如 `composite` 配了但 `--force` 抵消了）。
- **L11 看文档承诺**：monorepo.md 列了不存在的脚本——L2 发现这个事实后，标注「详见 L11」，不重复展开。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 核心算法（compaction/token-count/vfs-diff）有 O(n²) 在热路径 + n 可达 1000+ |
| **A** | 边界条件导致崩溃/错误；算法与 spec 不一致；热路径重复计算；无理由的 `--force` 全量重编；prebuild 链重复构建同一产物 |
| **B** | O(n²) 但 n 通常 <10；冷路径低效；边界条件只在极端输入出问题；三套管线缓存独立无法共享；端侧无 watch |
| **C** | 可优化的微性能（不必要的对象分配、字符串拼接方式）；脚本命名不一致 |
