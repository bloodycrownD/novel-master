# L3：架构 & 依赖

> 角度横扫指导。你是 lens-sweep 子代理，readonly，负责从**架构分层和模块依赖**这一个角度扫遍整个仓库。

## 你的一句话职责

查清这个仓库的**分层对不对、依赖有没有绕过规则、哪些模块是 god module、有没有循环依赖**。你的圣经是 `packages/core/ARCHITECTURE.md`——一切以它定义的分层规则为准。

## 你的独有抓手

- **分层违规**：domain 依赖了 service（禁止）、infra 依赖了 service（禁止）
- **facade 绕过**：外部包不通过 `@novel-master/core` 的公共面，而是走私路径（`core/dist/...` 或 `core/src/...`）
- **god module**：被大量模块依赖的单一文件，是架构瓶颈
- **循环依赖**：domain 内部 context 之间的循环引用
- **跨 context 的私有 import**：A context 直接 import B context 的内部文件，而不是通过 B 的 `index.ts`
- **ARCHITECTURE.md 的「Documented exceptions」是否还成立**：当初加的特例，现在是否还有必要

## 读什么文件

### 核心目标

| 目标 | 看什么 |
|------|--------|
| `packages/core/ARCHITECTURE.md` | **首要必读**——这是你评判一切的依据 |
| `packages/core/src/domain/*/` | 17 个 context 的内部结构，查跨 context import |
| `packages/core/src/domain/*/index.ts` | 各 context 的公共面 |
| `packages/core/src/service/*/` | 查 service 是否反向依赖 |
| `packages/core/src/infra/*/` | 查 infra 是否依赖 service |
| `packages/core/src/index.ts` | 顶层 facade，看导出了什么、漏了什么 |
| `apps/*/` | 查外部消费者怎么用 core |
| `packages/sksp-*`、`packages/tdbc-*`、`packages/tokenizer-*` | 查 driver 包怎么消费 core |

### grep 模式

```text
# 违规一：domain → service（ARCHITECTURE.md 禁止）
include: "packages/core/src/domain/**/*.ts"
regex: "from\s+['\"]([^'\"]*\/service\/[^'\"]*)['\"]"

# 违规二：infra → service（ARCHITECTURE.md 禁止）
include: "packages/core/src/infra/**/*.ts"
regex: "from\s+['\"]([^'\"]*\/service\/[^'\"]*)['\"]"

# 违规三：绕过 index.ts 的私路径（从 apps/ 和其他 packages/ 出发）
include: "apps/**/*.ts"  # 以及 packages/sksp-*/、packages/tdbc-* 等
regex: "from\s+['\"]@novel-master/core/(src|dist)/"

# 跨 context 私有 import（不走 index.ts）
include: "packages/core/src/domain/**/*.ts"
regex: "from\s+['\"]([^'\"]*\/domain\/([a-z-]+)\/[^'\"]*)['\"]"
# 然后检查：被引用路径是否是 index.ts？如果不是，就是私路径 import

# 找所有 index.ts 导出
find_path: "packages/core/src/**/index.ts"

# 找 errors/ 目录的分布（ARCHITECTURE.md 规定 errors 在包级别）
include: "packages/core/src/errors/**/*.ts"
```

## 相关 Iterations

**高优先（必读）：**
- `core-package-structure` — 当前分层结构的源头，ARCHITECTURE.md 就是从这来的
- `core-architecture-style` — 架构风格决策
- `agent-model-decouple` — agent 模型解耦，可能涉及拆分 context
- `agent-system` — agent 系统的架构设计
- `implementation-simplification` — 简化实现，可能删了一些层
- `codebase-audit-remediation` — 代码审计整改
- `post-1.3.14-large-debt-remediation` — 大债清理

**中优先（扫读）：**
- `core-test-fixture-sharing` — 测试 fixture 共享，涉及包结构
- `tool-system-v2` — tool 系统重构
- `worktree-engine-convergence` — worktree 引擎收敛
- `config-forms-merge-into-core` — config forms 合并进 core

## 典型问题清单 & 检查手法

### 1. 分层违规（domain → service）
**怎么查**：在 `domain/` 下搜任何 `from '...service...'`。每条命中，读上下文判断是真 import 还是注释/字符串。

**判定标准**：
- 确认是真 import 且无 ARCHITECTURE.md 例外说明，标 A
- 有例外说明但你觉得不合理，标 B 并列 open_question

### 2. 分层违规（infra → service）
**怎么查**：同上，在 `infra/` 下搜。

### 3. facade 绕过
**怎么查**：在 `apps/` 和外部 packages 下搜 `@novel-master/core/src/` 或 `@novel-master/core/dist/`。正常只应该 `from '@novel-master/core'`。

**判定标准**：
- 确认绕过且无 # 区域注释说明，标 A
- `dist/` 路径但只是类型 import（`import type`），标 B

### 4. 跨 context 私路径 import
**怎么查**：在 `domain/A/` 下搜 `from '...domain/B/...'`。如果 B 后面跟的不是 `index.ts` 或 `index.js`（即不是 barrel），就是私路径。比如 `from '../vfs/model/revision'` 而不是 `from '../vfs'`。

**对照 ARCHITECTURE.md 的「Documented exceptions」**：有些私路径是被允许的（比如 sqlite repository impl 和 port 同处一个 context）。其余的算违规。

**判定标准**：
- 违规且无例外说明，标 A
- 有例外说明，对照该例外是否还有必要（读相关 Iteration）

### 5. god module
**怎么查**：统计每个文件被 import 的次数。重点看：
- `packages/core/src/domain/*/index.ts`（被自己 context 内部和外部引用）
- 名字含 `manager`、`registry`、`resolver`、`factory`、`service` 的文件
- `packages/core/src/errors/` 下的文件

**判定标准**：被 5+ 个不同 context 引用的单一文件，标 A（架构瓶颈）；被 10+ 个文件引用，标 S。

### 6. 循环依赖
**怎么查**：建 domain context 的依赖邻接表。A context import 了 B context 的任何文件，就有一条 A→B 边。找环。

**判定标准**：有环且无 ARCHITECTURE.md 例外说明，标 S。

### 7. Documented exceptions 有效性
**怎么查**：逐条核对 ARCHITECTURE.md 的「Documented exceptions」一节。对每条例外：
- 读相关 Iteration，找到当初加这个例外的理由
- 判断那个理由现在是否还成立

**判定标准**：理由已不成立的例外，标 A（应删除）；理由模糊无法判定的，标 B。

## 与其他角度的潜在冲突

| 对方角度 | 可能的冲突 | 你的立场 |
|----------|-----------|----------|
| **L8 API 稳定性** | 你说「这个不该导出」，L8 可能说「但外部正在用」 | 如果外部确实在用，说明 facade 不完整——你标「facade 需要补充」而不是「违规」 |
| **L6 跨端** | 你说「这个应该走 index.ts」，L6 可能说「但三端需要不同的实现」 | 如果三端分歧是合理的，可能是 facade 设计需要支持多态，不是简单违规 |
| **L1 数据模型** | 你说「这个 context 不该有 repository」，L1 可能说「但它确实需要持久化」 | 持久化需求本身没错，但位置可能不对（该移到 infra 还是留在 domain，看 ARCHITECTURE.md 的例外条款） |

## 输出格式

遵守 `CR-LOOP-GUIDE.md` 的文档结构规范。文件路径 `docs/review/phase1-lens/D1-03-architecture.md`。

在「结论」节，叙述式讲清楚：这个仓库的分层整体执行得怎么样、ARCHITECTURE.md 的规则有没有被遵守、哪些地方在腐化。

**特别要求**：你的报告里必须包含一张**依赖关系总览表**（Top 10 被引用最多的文件 + 被哪些 context 引用），这张表会被 phase2 和 phase3 反复引用。

在「待交叉的线索」节，标出你发现的违规中哪些可能和 L8（API）或 L6（跨端）有冲突。

## 严重度参考

| 级别 | 场景 |
|------|------|
| **S** | 循环依赖；god module 被 10+ 文件引用；系统性 facade 绕过 |
| **A** | domain→service 违规；跨 context 私路径 import；失效的 documented exception |
| **B** | 轻度耦合（可接受但值得注意）；index.ts 导出过多（公共面过宽） |
| **C** | barrel 文件组织混乱；re-export 链过长 |
