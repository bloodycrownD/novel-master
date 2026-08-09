# Phase 0：侦察指导

> 主代理亲自执行，不派子代理。产出 `docs/review/phase0/D0-1-code-map.md` 和 `D0-2-docs-index.md`，同时创建 `.cr-loop-state.yaml`。

## 目标

为整个 CR loop 建立两张地图：**代码地图**（谁依赖谁、哪里违规）和**文档地图**（哪个迭代对应哪些模块、哪些模块被反复改过）。没有这两张图，后续角度横扫和模块切片就是瞎子摸象。

## D0-1：代码地图 & 依赖分析

### 1. 目录结构清点

把以下目录的文件数、总行数统计出来，形成一张表：

- `packages/core/src/domain/*/` — 17 个 bounded context
- `packages/core/src/service/*/` — 17 个 service
- `packages/core/src/infra/*/` — 12 个 infra 能力
- `packages/core/src/bootstrap/*/` — 13 个 bootstrap
- `packages/core/src/errors/`
- `packages/core/src/config-forms/`
- `packages/core/src/types/`
- `packages/core/src/public/`
- `apps/cli`、`apps/desktop`、`apps/mobile` 各自的 src

统计命令参考（PowerShell）：

```powershell
Get-ChildItem -Path packages\core\src\domain -Directory | ForEach-Object {
    $count = (Get-ChildItem $_.FullName -Recurse -File -Filter *.ts).Count
    $lines = (Get-ChildItem $_.FullName -Recurse -File -Filter *.ts | Get-Content | Measure-Object -Line).Lines
    [PSCustomObject]@{ Module = $_.Name; Files = $count; Lines = $lines }
} | Sort-Object Lines -Descending | Format-Table
```

对 `service/`、`infra/`、`bootstrap/` 重复同样操作。这张表写进 D0-1 的「模块体量排名」，体量大的优先进 phase2 切片候选。

### 2. 分层违规扫描

对照 `packages/core/ARCHITECTURE.md` 的依赖规则表，扫描三类违规：

**违规类型一：domain → service（禁止）**

```text
grep 模式：在 packages/core/src/domain/ 下的所有 .ts 文件里
搜索 from '../../../service/' 或 from '../../service/' 或 from '.*service/'
```

用 grep 工具搜 `include_pattern: "packages/core/src/domain/**/*.ts"`，regex `from ['"].*service/`。每条命中检查是否真的是 import（排除注释和字符串）。

**违规类型二：infra → service（禁止）**

```text
grep 模式：在 packages/core/src/infra/ 下的所有 .ts 文件里
搜索 from '.*service/'
```

**违规类型三：绕过 index.ts facade 的私路径 import**

```text
在 apps/ 和其他 packages/ 下搜索
from '@novel-master/core/dist/' 或 from '@novel-master/core/src/'
```

正常应该只 `from '@novel-master/core'`（走 `index.ts` 公共面）。任何 `dist/` 或 `src/` 深路径都是违规。

### 3. 依赖图核心节点（god module 候选）

找出被引用次数最多的文件——这些是 god module 候选，往往是架构瓶颈。

```text
对 packages/core/src/ 下每个 .ts 文件，统计被其他文件 import 的次数。
方法：grep 每个文件名（不含扩展名），看出现在多少个其他文件的 import 语句里。
```

实操上不需要精确统计全部 554 个文件，重点扫：
- `index.ts`（各模块的 barrel）
- 名字带 `service`、`manager`、`factory`、`resolver`、`registry` 的文件
- 名字带 `port`、`adapter` 的文件

把 Top 20 被引用最多的文件列出来，标出「哪些被跨 context 引用」（这些是耦合热点）。

### 4. 循环依赖检测

重点查 domain 内部 context 之间的循环：

```text
对 domain/ 下每个子目录，看它 import 了哪些其他 domain 子目录。
如果 A imports B，B imports A，就是循环。
```

方法：grep `include_pattern: "packages/core/src/domain/**/*.ts"`，regex `from ['"].*domain/([a-z-]+)/`，提取被引用的 context 名，建邻接表找环。

### 5. schema / migration 分布

把所有 DDL 和 migration 文件列出来，看哪个 context 有持久化：

```text
find_pattern: "packages/core/src/bootstrap/**/*.ts"
grep: CREATE TABLE|ALTER TABLE|CREATE INDEX
```

每个有 CREATE TABLE 的 bootstrap 子目录，对应一个有持久化的 context。记下表名，供 L1（数据模型角度）用。

### D0-1 文档结构

```markdown
# D0-1：代码地图 & 依赖分析

## 1. 模块体量排名
<domain/service/infra/bootstrap 各自的 表：模块 | 文件数 | 行数>

## 2. 分层违规清单
### domain → service 违规
### infra → service 违规
### 绕过 index.ts 的私路径 import

## 3. God module 候选（Top 20 被引用）
<表：文件 | 被引用次数 | 被哪些 context 引用>

## 4. 循环依赖
<邻接表 + 找到的环>

## 5. 持久化分布
<表：bootstrap 模块 | 表名 | 对应 domain context>

## 6. 初步观察（叙述式，2-3 段）
<哪些模块异常大、哪些违规最多、哪些是耦合热点>
```

---

## D0-2：文档索引 & 模块候选定稿

### 1. Iterations 主题归类

把 `docs/Iterations/` 下 120+ 个目录按涉及的 bounded context 归类。方法：

- 先读每个迭代目录下的 `prd.md` 或 `spec.md` 的标题/摘要（不用读全文，读前 30 行就够判断主题）
- 如果没有 prd/spec，从目录名推断

归类维度（对应 domain 下的 context）：

| bounded context | 相关 Iterations（举例，需补全） |
|----------------|------|
| compaction-conditions | global-compaction-policy, event-bus-compaction-conditions, compaction-agent-update, agent-config-and-compaction |
| vfs | VFS, vfs-version-redesign, vfs-revision-storage-optimize, vfs-unified-root, chat-project-vfs, virtual-worktree, worktree-engine-convergence, ... |
| provider | provider-identity, provider-model, saved-model-identity, opencode-builtin-provider, llm-protocol-anthropic-gemini-parity |
| message | message-checkpoint-v2, message-visibility, message-set-floor, message-delete-worktree-narrow-refresh, ... |
| ... | ... |

### 2. 模块摇摆度打分

对每个候选模块，从 Iterations 里数「涉及该模块的迭代数量」。迭代越多的模块，越可能「被反复改过 = 没想清楚」。这就是摇摆度。

打分公式（粗筛用）：

```text
摇摆度 = 涉及该模块的 Iterations 数量
权重加成：如果 D0-1 显示该模块代码量大（Top 10），摇摆度 × 1.5
权重加成：如果 D0-1 显示该模块有分层违规或循环依赖，摇摆度 × 1.3
```

### 3. 模块清单定稿

按摇摆度排序，选 Top 6-8 进 phase2 完整切片，其余标「横扫-only」。

输出一张表：

| 排名 | 模块 | 摇摆度 | 代码量 | 违规数 | 入选 | 理由 |
|------|------|--------|--------|--------|------|------|
| 1 | compaction | 高 | 中 | 有 | ✅ 切片 | 反复改、涉及事务 |
| 2 | vfs | 极高 | 大 | 有 | ✅ 切片 | 迭代最多、数据模型复杂 |
| ... | ... | ... | ... | ... | ... | ... |
| 9 | regex | 中 | 小 | 无 | 横扫-only | 稳定，不深挖 |

这张表就是 phase2 的执行清单，也是 `.cr-loop-state.yaml` 里 `matrix.modules` 的来源。

### 4. 为每个角度标注相关 Iterations

最后给 8 个角度各自列出「最该读的 Iterations」，写进 D0-2 的一张大表。这张表会被各 lens 指导文档引用（lens 指导文档里写「详见 D0-2 的角度×迭代映射」）。

| 角度 | 高优先 Iterations | 中优先 |
|------|-------------------|--------|
| L1 数据模型 | storage-schema-alignment, message-checkpoint-v2, vfs-revision-storage-optimize, persistent-state-and-preferences | ... |
| L2 算法 | compaction-agent-update, model-aware-token-counting, regex-system, prompt-engine | ... |
| ... | ... | ... |

### D0-2 文档结构

```markdown
# D0-2：文档索引 & 模块候选定稿

## 1. Iterations 主题归类
<按 bounded context 分组的迭代清单>

## 2. 模块摇摆度打分
<表 + 排序>

## 3. 模块清单定稿
<切片入选 vs 横扫-only 的最终表>

## 4. 角度 × 迭代映射
<8 个角度各自该读哪些 Iterations>

## 5. 定稿观察（叙述式）
<哪些模块入选/落选的判断逻辑>
```

---

## 完成标志

Phase 0 done 的标志：

- [ ] `D0-1-code-map.md` 已产出，含 6 节
- [ ] `D0-2-docs-index.md` 已产出，含 5 节，模块清单已定稿
- [ ] `.cr-loop-state.yaml` 已创建，`matrix.modules` 已填入定稿清单，`matrix.coverage` 初始化为全 `pending`
- [ ] `current_phase` 设为 `phase1`，`wave_plan` 已排出 phase1 的 8 个 lens-sweep 节点
- [ ] `status` 设为「待 Phase 1 角度横扫」

完成这些后，主代理向用户汇报 Phase 0 结论，等用户确认模块清单（或直接放行进 Phase 1）。
