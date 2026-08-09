# L7：测试 & 可测性

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**测试覆盖和可测性**这一个角度扫遍整个仓库。

## 你的一句话职责

查清这个仓库里**哪些核心路径有测试、哪些没有、测试质量怎么样、代码本身好不好测**。你不是来跑测试的——你只看测试文件的存在性、分布、质量。

## 你的独有抓手

- **核心路径零测试**：被大量引用的 domain logic / service 方法没有对应测试
- **测试耦合实现细节**：测试不是在验证行为，而是在验证内部实现（mock 了太多内部模块、断言了私有方法）
- **脆弱测试**：依赖执行顺序、依赖时间、依赖文件系统状态——换个环境就挂
- **fixture 共享不足**：每个测试自己造数据，没有共享 fixture，导致数据模型变了就要改一堆测试
- **错误路径未测**：只测了 happy path，rollback / abort / 部分失败完全没测
- **跨层测试缺失**：domain → service → repo 的集成路径没有端到端测试
- **可测性差**：代码没有依赖注入、硬编码了副作用（直接 new Date()、直接调 IO），导致无法隔离测试

## Phase 0 已确认的测试覆盖现实

Phase 0 侦察已统计了 `packages/core/test/` 的全部测试文件分布，**不需重复统计**：

### 测试密度排名（已知）

**测试健康的**（密度高）：
| 模块 | 测试文件 | src 行数 | 密度 |
|------|---------|---------|------|
| events | 4 | 94 | 1/24 |
| agent | 18 | 752 | 1/42 |
| provider | 26 | 1652 | 1/64 |
| message-checkpoint | 17 | 1207 | 1/71 |
| prompt | 13 | 1006 | 1/77 |
| depth | 2 | 161 | 1/80 |

**测试盲区（L7 重点查）**：
| 模块 | 测试文件 | src 行数 | 密度 | 问题 |
|------|---------|---------|------|------|
| **regex** | **3** | **1014**（727 domain + 287 service） | **1/338** | **严重不足**——正则引擎是核心逻辑 |
| **bootstrap** | **7** | **2661** | **1/380** | schema/migration 正确性风险高 |
| **cloud-sync** | **2** | **532** | **1/266** | 同步是数据安全核心 |
| **session-kkv** | **1** | **298** | **1/298** | KV 存储测试极少 |
| **sksp** | **1** | **221** | **1/221** | 密钥存储测试不足 |
| **kkv** | **1** | **184** | **1/184** | 基础 KV |
| **config-forms** | **6** | **1216** | **1/203** | 配置表单 |
| **vfs** | 31 | 5512 | 1/178 | 密度中等但代码量巨大，盲区可能藏在量里 |
| **chat** | 49 | 6797 | 1/139 | 密度中等，同 vfs |
| **compaction-conditions** | 3 | 412 | 1/137 | 触发逻辑高复杂度 |

### 你的重点因此明确为：

1. **regex**：3 个测试覆盖了什么？正则引擎的 NFA/DFA 匹配、规则优先级、边界条件是否测了？
2. **bootstrap 迁移**：8 个迁移脚本（含 vfs-entry-id-redesign 9 CREATE）的幂等性、重跑安全性有没有测？
3. **cloud-sync**：租约锁、状态机、并发同步有没有测？
4. **vfs/chat 的量中藏质**：31/49 个测试文件看起来多，但 5512/6797 行代码里可能有大量未测的错误路径
5. **compaction-conditions**：触发条件的各种组合是否测了？

## 读什么文件

### 核心目标

| 目录 | 为什么看 |
|------|----------|
| `packages/core/test/` | 核心测试目录（已扫，30 个子目录） |
| **`packages/core/test/regex/`** | **重点**——只有 3 文件覆盖 1014 行 |
| **`packages/core/test/bootstrap/`** | **重点**——只有 7 文件覆盖 2661 行 |
| **`packages/core/test/cloud-sync/`** | **重点**——只有 2 文件覆盖 532 行 |
| `packages/core/test/helpers/` | 测试工具和 fixture |
| `packages/core/test/package-exports/` | 公共面导出测试 |
| `apps/mobile/` 下 e2e 相关 | mobile e2e（Appium） |
| `packages/core/src/domain/*/logic/` | 对比这些纯函数是否都有对应测试 |

### grep / find 模式

```text
# 找所有测试文件
find_path: "packages/core/test/**/*.test.ts"

# 找所有 e2e 文件
find_path: "apps/mobile/**/*e2e*"

# 找 describe/test/it 块（统计测试数量和分布）
include: "packages/core/test/**/*.ts"
regex: "describe\s*\(|test\s*\(|it\s*\("

# 找 mock 使用（过度 mock 嫌疑）
include: "packages/core/test/**/*.ts"
regex: "vi\.mock|jest\.mock|mock\(|spyOn|\.mockImplementation"

# 找 fixture / helper 使用
include: "packages/core/test/**/*.ts"
regex: "fixture|helper|factory|builder|seed"

# 找硬编码副作用（可测性问题，在 src 里找）
include: "packages/core/src/**/*.ts"
regex: "new Date\s*\(\s*\)|Date\.now\s*\(\s*\)|Math\.random\s*\(\s*\)"

# 找依赖注入 vs 硬编码（可测性）
include: "packages/core/src/**/*.ts"
regex: "new\s+\w+(Service|Repository|Manager|Factory|Adapter)\s*\("  # 硬编码 new，没走注入
```

## 相关 Iterations

**高优先（必读）：**
- `core-test-fixture-sharing` — fixture 共享设计，直接告诉你测试架构的意图
- `mobile-android-e2e-appium` — mobile e2e 测试策略
- `post-1.3.14-code-review` — 之前的 code review（可能发现过测试问题）
- `codebase-audit-remediation` — 代码审计整改（可能包含测试整改）

**中优先（扫读）：**
- `mobile-prototype-session-drawer` — 可能有测试 fixture 相关
- `tdbc-conformance`（packages/tdbc-conformance/） — TDBC 一致性测试，看测了什么

## 典型问题清单 & 检查手法

### 1. 核心路径零测试
**怎么查**：对比 `domain/*/logic/` 下的纯函数文件和 `test/*/` 下的测试文件。每个 logic 文件应该有对应测试。没有的就是覆盖盲区。

重点检查这些高优先模块：
- `compaction-conditions` 的触发条件计算
- `message-checkpoint` 的 diff / rollback 逻辑
- `vfs` 的 revision 合并/选择
- `regex` 的匹配引擎
- `prompt` 的模板展开
- `tokenizer` 的计数逻辑

**判定标准**：核心 logic 无任何测试，标 A；有测试但只覆盖 happy path，标 B。

### 2. 错误路径未测
**怎么查**：对有测试的模块，检查测试里有没有：
- rollback 路径的测试
- abort / cancel 路径的测试
- 部分失败（第二步崩了）的测试
- 边界条件（空输入、超长输入）的测试

**判定标准**：错误路径完全没测，标 A（和 L4 错误处理角度高度相关）。

### 3. 测试耦合实现细节
**怎么查**：扫测试文件里的 mock 使用。如果一个测试 mock 了 >3 个内部模块，或者在断言私有方法/内部状态，就是在测实现而非行为。

**典型场景**：
- 测试 compaction 时 mock 了 repo、service、event bus、tokenizer——实际在测 mock 而非 compaction 逻辑
- 测试断言了 `expect(service['privateMethod']).toHaveBeenCalled()`——耦合私有实现

**判定标准**：mock 过多导致测试实际不覆盖真实逻辑，标 A；断言私有方法，标 B。

### 4. 脆弱测试
**怎么查**：找以下模式：
- 测试依赖执行顺序（`test` 之间共享状态）
- 测试依赖当前时间（没有 mock `Date.now()`）
- 测试依赖文件系统（没有用临时目录或 in-memory）
- 测试依赖网络（没有 mock 外部 API）

**判定标准**：跨环境会挂的测试，标 A。

### 5. fixture 共享不足
**怎么查**：读 `core-test-fixture-sharing` 的 spec，理解预期的 fixture 架构。然后对比当前实现：
- 有没有集中的 fixture factory？
- 各 context 测试是否在用共享 fixture？
- 还是各自手搓数据？

**判定标准**：数据模型变更需要改 >10 个测试文件（说明 fixture 没共享），标 A。

### 6. 可测性差
**怎么查**：在 src 里找硬编码副作用：
- `new Date()` / `Date.now()`——时间不可控
- `Math.random()`——随机性不可控
- `new XxxService()`——硬编码依赖，无法注入 mock

**判定标准**：核心 logic 里有硬编码副作用导致无法单元测试，标 A。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L4 错误处理** | 你说「错误路径没测」，L4 说「错误路径有问题」 | 这俩是互补的——L4 发现问题，你发现「问题还没被测试捕捉到」。标 A 并引用 L4 的发现 |
| **L2 算法** | 你说「边界条件没测」，L2 说「边界条件会崩」 | 同上——互补关系。你关注「没有测试保护」，L2 关注「行为本身错」 |
| **L3 架构** | 你说「可测性差（硬编码依赖）」，L3 可能说「这是合理的架构选择」 | 可测性是架构质量的一部分——如果你发现硬编码导致无法测试，就是架构问题 |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-07-testing.md`。

在「结论」节，叙述式讲清楚：这个仓库的测试文化是什么样的——TDD 还是「先写后补」？覆盖率盲区在哪？测试质量（不是数量）怎么样？

**特别要求**：你的报告必须包含一张**测试覆盖矩阵**——行是核心模块（compaction / vfs / message / provider / ...），列是 [happy path | 错误路径 | 边界条件 | 并发场景 | 集成路径]，格子填 ✓ / ✗ / 部分。这张表会被 phase2 反复引用。

在「待交叉的线索」节，标出哪些覆盖盲区和 L4（错误处理）或 L2（算法）的发现相关。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 核心模块（compaction / message-checkpoint / vfs）完全无测试 |
| **A** | 错误路径/rollback 无测试；测试耦合实现细节；可测性差（硬编码副作用） |
| **B** | 只测 happy path；fixture 未共享；脆弱测试 |
| **C** | 测试命名不规范；缺少注释说明测试意图 |
