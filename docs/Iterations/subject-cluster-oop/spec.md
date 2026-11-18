# subject-cluster-oop：命名级主体聚类收口（完整方案）

> 目标仓库：`D:/worktree/error-channel-slim`（分支 `feat/error-channel-slim`）
> 基线：`p23-create-factory`（若尚未打 tag 则以其 HEAD 为基线）
> 目标 tag：`p24-subject-cluster-core`（core 全部）→ `p25-subject-cluster-apps`（apps + packages 全部）

## 一、判据

**统一原则：概念单元该拥有它的全部操作；作用范围由结构（namespace / class）表达，不由名字后缀表达。**

`create*` 与其他动词族是同一原则的两面：

| 视角 | 信号方向 | 终态形态 |
|---|---|---|
| p23（已立项） | 同一动词（create）、多主体 → 各主体自己的 Factory | `VfsServiceFactory.create(...)` |
| 本 spec | 同一主体、多种动词 → 主体 namespace | `SessionApiPromptTokenEntry.read(...)` |

**更根本的信号：顶层裸函数本身就是异常态**——即使构不成 ≥3 动词的族，裸的顶层 export 也不该是默认形态。仓库已有正面先例：`common/` 25 个函数在 p12 收成了 `Coerce`/`Guards`/`Text`/`Number`/`TokenFormat` 11 个 namespace，其中很多是单函数或小函数族。同一仓库两种风格并存，正是「糟糕」的来源。

三个可机械化信号：同主体多动词族、修饰词复读（`ForTests` ×30 / `After*` ×10 / `FromLayout` ×6 / `InTransaction` ×3）、超长名（≥32 字符 38 个）。

## 二、总量盘点（完整覆盖，不留尾巴）

基线 `all-signatures-p24.txt`（3162 签名），按「含裸 export function 的文件」分桶（排除 `.tsx` 组件）：

```
663 个文件，1881 个裸函数 —— 本方案 100% 覆盖，分两轮
```

| 域桶 | 文件 | 函数 | 归属轮次 |
|---|---|---|---|
| desktop/src/main | 66 | 297 | p25 |
| mobile/src/web | 50 | 228 | p25 |
| mobile/src/services | 59 | 186 | p25 |
| core/domain/vfs | 46 | 131 | p24 |
| packages/*（drivers 等） | 39 | 99 | p25 |
| mobile/src/components | 32 | 95 | p25 |
| core/domain/tool | 23 | 75 | p24 |
| core/infra/llm-protocol | 27 | 73 | p24 |
| core/infra/tokenizer | 21 | 58 | p24 |
| core/domain/workplace | 15 | 49 | p24 |
| core/domain/chat | 17 | 36 | p24 |
| core/domain/provider | 19 | 35 | p24 |
| core/domain/message-checkpoint | 15 | 31 | p24 |
| mobile/src/storage+config-forms+screens+hooks+runtime+webview-host+db+其余 | ~40 | ~130 | p25 |
| core/service/*（vfs/agent/chat/prompt/provider/workplace/message-checkpoint/skills/compaction/template/kkv/persistent-* 等） | ~45 | ~120 | p24 |
| core/infra/*（sql-template/log/serialization/tdbc/sksp/db-backup/cloud-sync/db-maintenance/prompt-template） | ~40 | ~80 | p24 |
| core/common+errors+i18n+presentation+bootstrap+domain 杂项 | ~30 | ~90 | p24 |
| **合计** | **663** | **1881** | |

**精确清单生成器**：分桶脚本 `D:/tmp/bare-buckets.py` 随本 spec 移入 `scripts/list-bare-exports.mjs`（步骤 1 实现），按域桶输出精确到文件的清单。**执行分片必须用生成的清单，禁止 agent 自选范围。**

## 三、统一改法（机械规则，执行者不做风格判断）

### 3.1 namespace 命名

- 默认：**文件名 PascalCase**（`vfs-path-mapper.ts` → `VfsPathMapper`）。
- 例外：文件名带动词前缀（`create-abort-scope.ts`）或名字与域内已有符号冲突时，按**内容主体**起名（`AbortScopeFactory` / `AbortScopeImpl`），notes 登记理由。
- 一个文件一个 namespace。文件内全部裸 export function 收进去；非 export 的顶层函数**同时收**（同文件内调用改为 `Ns.fn(...)`）。

### 3.2 成员名剥离

- 函数名包含 namespace 主体词的**剥离主体词**：`resolveLogicalPath` → `VfsPathMapper.resolve`；`parseSessionApiPromptTokenEntry` → `SessionApiPromptTokenEntry.parse`。
- 无主体词的保留：`read` / `write` / `parse`。
- 剥后撞名：保留区分性修饰（`resolveNeedDelete`），不许留 `resolve2`。

### 3.3 硬切，不留兼容壳

- 旧顶层名一律删除，**禁止留 `export const resolveLogicalPath = VfsPathMapper.resolve` 别名壳**（p22 已判死刑的形态）。
- 消费方 import 与调用点同步迁移（分片见 §四）。

### 3.4 豁免清单（豁免必须显式，默认不允许）

| 豁免 | 判据 | 标注 |
|---|---|---|
| React 组件 | `.tsx` 文件内、返回 JSX、PascalCase | 自动豁免 |
| React hooks | `use` 前缀（React 顶层调用规则，不可收 object） | 自动豁免 |
| test 目录 | `test/`、`__tests__/` | 自动豁免（检测器 `--include-tests` 才扫） |
| 显式豁免 | 其他确有理由的 | `// nm-style: keep-bare: <理由>`，进 baseline |

**豁免总量预估**：hooks（`mobile/src/hooks` 14 个 + 散布的 `use*`）、组件文件——最终裸函数余量以检测器为准，验收口径是「豁免外 = 0」。

### 3.5 既有裁决不翻案

- p23 的 `XxxFactory`（create 族）保持原样，它们已经是 namespace 形态。
- 十八期保留项（persistent-preferences 27 门面、composer-status 双端镜像）不动。
- `common/` 11 个 namespace（p12 成果）是目标形态的先例，不重做。

## 四、批次规划

### p24：core 全部 + 规则层（约 400 文件 / 780 函数）

| 波 | 内容 | 分片 |
|---|---|---|
| 0 | 规则层：SKILL.md 统一判据 + `check-style` 第四段 `bare-exports`（`--changed` 拦新增）+ `scripts/list-subject-clusters.mjs` + `scripts/list-bare-exports.mjs` | 1 |
| 1 | A 类族（core 侧 5 族）：`SessionApiPromptTokenEntry` / `LogicalPath` / `ChatTokenEstimateMemo` / `FsCommand`（先并文件）/ `ProviderTableSnapshot`（先并文件）——判据已定，机械执行 | 1-2 |
| 2 | C 类族判定（core 侧：`FileCachePayload` / `VfsZip`（core 侧）/ `InTransaction` 的 `resolvePathsNeedDeleteInTransaction`）——**只读**，产出处置 + 证据 | 1（只读） |
| 3 | core/domain 桶：vfs / tool / workplace+smart-sort+skills+format+depth / chat+provider+message-checkpoint+prompt+abort+agent+session-kkv+character-card+session-run-state+usage | 4 片并行 |
| 4 | core/infra 桶：llm-protocol+tokenizer / sql-template+log+serialization+tdbc+db-backup+cloud-sync+db-maintenance+sksp+prompt-template | 2 片并行 |
| 5 | core/service 桶 + common/errors/i18n/presentation/bootstrap 桶 | 2 片并行 |
| 6 | apps 侧消费点迁移：波 1-5 圈出的 desktop/mobile/packages-drivers 消费文件 | 按包 3 片 |
| 7 | C 类「收」的实施 + FromLayout 6 别名复核 | 1 |
| 8 | 收敛：根 typecheck + 三端全量 + 四段门 + dup-gate → tag `p24-subject-cluster-core` | 1 |

### p25：apps + packages 全部（约 263+39 文件 / 1100 函数）

结构与 p24 同构，基线 = p24 tag：

| 波 | 内容 | 分片 |
|---|---|---|
| 0 | A 类族（mobile 侧 8 族）：`MobileDatabaseFilePath` / `RebootWaiter` / `SessionViewCache` / `ChatComposerDraft` / `ContextMenu`（注意同文件 `contextMenuViewSlot` 职责不同）/ `RowWindow` / `StreamRichUpgrade` / `PreciseUpgrade`（待判） | 2 片 |
| 1 | C 类族判定（`StreamRowIds` ×5 / `DbMaintenance` do-handle-run / `HostMessage.handle` ×4 / `VfsZip` mobile 侧） | 1（只读） |
| 2 | mobile/src/web 桶（50 文件 228 函数） | 2 片 |
| 3 | mobile/src/services+storage+db+runtime 桶 | 2 片 |
| 4 | mobile/src/components+config-forms+screens+hooks（hooks 豁免）+webview-host 桶 | 2 片 |
| 5 | desktop/src/main 桶（66 文件 297 函数） | 3 片 |
| 6 | packages/* 桶（39 文件 99 函数；**改完由主代理串行重建对应 dist**） | 1 片 |
| 7 | C 类「收」实施 | 1 |
| 8 | 收敛 + tag `p25-subject-cluster-apps` | 1 |

## 五、明确不做

- **不改任何函数体**。全部改动是：函数搬进 object、成员名剥主体词、调用点改 `Ns.fn(...)`、删旧名。
- **不翻既有裁决**（p23 Factory、十八期保留项、p12 的 common namespace）。
- **不动 public exports 子路径**；`public/*.ts` 的 re-export 行随符号改名同步更新，子路径不变。
- **不合并文件**（除 A′ 两族既定判决）。
- **不为改短而改短**：长名只在族收口顺带解决时才变短。

## 六、验收

```
1. 根 typecheck                          exit 0（14 workspace）
2. core / desktop / mobile 全量测试       exit 0
3. check-style 四段                       signatures / inline / methods PASS；bare-exports 新增 0
4. dup-gate                               新增 0（namespace 化产生同方法名新组 → 登记 baseline + 理由，不算违规）
5. list-subject-clusters --gate           新增族 0、新增裸导出 0
6. 裸导出总量（豁免外）                    p24 后 core 侧 0；p25 后全仓 0
7. A 类 13 族旧顶层名全仓 grep             0 残留
8. C 类每族一条明确结论（收/跳过 + file:line 证据），不允许「未判定」
9. FromLayout 别名按复核结论处置，残留每个带 keep 理由
10. 每批 commit message 带该批「文件数 / 函数数 / 调用点数」三数字
```

## 七、风险

| 风险 | 缓解 |
|---|---|
| 调用点迁移量大（估算 5000+），跨包交叉 | 波 6/波 p25-6 按包分片 + 分析脚本圈精确清单；core 先行、apps 消费点单独波次，绝不混在改码片里 |
| namespace 化后 dup-gate 报同方法名新组 | 预期内，SSE parser feed/drain 先例，登记 + 理由 |
| mobile webview 函数在 bundle 闭包有本地镜像 | 改前 grep 同名，镜像按「代码镜像合并」判 |
| `create-abort-scope.ts` 24 函数等大文件改名波及面广 | 已单列（p24 波 3 域桶内）；notes 记录改名映射 |
| hooks 误收 object 破坏 React 规则 | 豁免规则 §3.4 自动判 `use` 前缀；检测器同步过滤 |
| 两轮之间基线漂移 | p25 基线锁 p24 tag；p24 期间 SKILL.md 门已生效，p25 的新增裸导出从第一片就拦 |
| token 消耗 | 每片独立 commit、独立自验；片内先圈清单再改，禁止全量 typecheck 每步跑 |

## 八、检测器规格（波 0 产出）

```bash
node scripts/list-subject-clusters.mjs <repo> --all            # 四种视图
node scripts/list-subject-clusters.mjs <repo> --gate           # 与 baseline 比对，新增 exit 1
node scripts/list-bare-exports.mjs <repo> --bucket core/domain/vfs   # 按域桶输出精确文件清单
node scripts/list-bare-exports.mjs <repo> --summary                 # 域桶汇总表
```

四种视图：同主体族 / 修饰词复读 / 长名榜 / 裸函数榜（按文件聚合计数 + 域桶汇总）。

过滤内置：组件名、`ByXxx` 查找器、`Obj.method` 形态、`use` hooks、`.tsx` 组件、test 目录（`--include-tests` 才扫）、`nm-style: keep-bare` 标注。
