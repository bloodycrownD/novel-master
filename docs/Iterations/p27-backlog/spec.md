# p27：六项技术欠账（throw 欠账 / class 收敛 / 裸 let / SQL 模板迁移 / SQL 格式 / i18n 深化）

> 目标仓库：`D:/Dev/Js/novel-master`（main @ `dc9ed7efd`，p1-p26 已合并）
> 目标 tag：`p27-backlog`
> 范围：R1-R7（R7 为用户授权 agent 自判的 renderer signatures 收敛）
> 前置：无（七项相互独立，可并行派片；R1-R4 与 R7 是结构/迁移线，R5/R6 是工具与文案线）

## 零、七项总览与侦察数据（2026-11-21 实测）

| 编号 | 主题 | 实测规模 | 性质 |
|---|---|---|---|
| R1 | throw-audit 欠账 | VIOLATION 7 + VIOLATION-B 64 + UNTRIAGED 29 | 错误通道收尾 |
| R2 | 无状态 class → namespace 候选 | 139 个 class（排 test/cli/dist） | 结构收敛 |
| R3 | 模块顶层裸 let 收编 | 89 处可变 let | 结构收敛 |
| R4 | 拼接 SQL 迁 SqlTemplate | 62 处 `${}` 插值 + filter 三函数 | 迁移（**底座已存在**） |
| R5 | SQL 常量格式化 | 29 个 `*_SQL` 常量，最长单行 1061 字符 | 可读性 + 规则豁免 |
| R6 | UI 硬编码文案 i18n 化 | mobile 862 + desktop 578 ≈ 1440 处 | 迁移工程 |
| R7 | renderer signatures 自判收敛 | desktop/renderer 374 条（ARGS 140 / VARDECL 119 / PARAMS 100 / IMPORT 9 / ASSIGN 6） | 规则边界裁决 + 执行 |

## 一、R1：throw-audit 欠账清算

### 1.1 范围

`scripts/throw-audit-baseline.json` 当前 166 键，全量扫描 180 站点：

- **VIOLATION = 7**：矩阵判「函数返回 Result/Outcome 却 throw」——唯一修法改 `return`，签名接力。
- **VIOLATION-B = 64**：函数不返回 Result 且体内无 catch——该层改返 Result 或登记边界。
- **UNTRIAGED = 29**：定性欠账（renderer `throw new Error` 为主，如 `SettingsViews.tsx:1349`「自定义参数必须是 JSON 对象」）。

### 1.2 执行

1. 先定性后修复：对 29 处 UNTRIAGED 逐处出 verdict（`--write-baseline` 更新），再按矩阵修 VIOLATION/VIOLATION-B。
2. **档3 并入**：`throw createAbortError` 已入 T2 表——`message.service.ts:262/314/331`（事务内的 314/331 已白名单化，剩 262）、`session.service.ts:309`、`export-database-backup.ts:41`、mobile 4 处入口检查点，按 p26 同款判据处理（事务回滚白名单 / 改 `return Outcome.cancelled` / assert）。
3. renderer 的 `throw new Error`（参数校验类）：对齐 mobile 已有先例——改 `return Result.err(new AppError("CLI_INVALID_ARGUMENT" 同款码, {detail}))` 或该端等价码；**不许**把校验失败静默吞掉。
4. 修复后 `nm-style throw-audit --gate` 要求 **UNTRIAGED=0 且 VIOLATION+VIOLATION-B ≤ 5**（余量留给确有理由的，逐条带理由登记）。

### 1.3 验收

```
- throw-audit --gate exit 0，UNTRIAGED=0
- 每处修复/登记在 commit message 列 file:line + verdict + 理由
- 三端测试全绿
```

## 二、R2：无状态 class 定性收敛

### 2.1 现状与判据

全仓 139 个 class（排 test/cli/dist）。**不是全收**，判定矩阵：

| 类别 | 处置 | 例 |
|---|---|---|
| `extends Error`（控制流哨兵） | **保留**（p19 裁决） | `DatabaseReplacedError` 等 11 个 |
| 三方/infra 封装（有真实实例生命周期） | **保留** | `XMLParser`/`XMLBuilder`/`XMLValidator`/`SqlTemplateParser` |
| 接口实现（`implements XxxPort`，端口契约） | **保留**（p17 V4 裁决） | `DefaultMessageRollbackService` 等 `Default*` |
| **有真实共享可变状态** | **保留**（这才是真 oop） | `ToolRunner`、`TransactionalConnection` |
| **无状态 + 非接口实现 + 无继承** | **namespace 候选**——逐类读实现定性 | `UserMessageFormatter`（若纯函数集）、`WebTokenizerCounter`（若无状态） |

判定动作：每类产出 `类名 | 状态? | 接口? | 判定（保留/收编）| 理由` 表，**只收编「无状态+非接口」桶**；有争议的（疑似无状态但有方法间共享字段）标 `REVIEW` 不动。

### 2.2 验收

```
- 全量 139 类定性表落 docs/apm/memory 或 baseline
- 收编桶：旧类名 grep=0，namespace 形态对齐 p25 规则（文件名=PascalCase、成员剥主体词）
- 接口实现桶零改动（端口契约不动是硬约束）
- typecheck + 三端测试绿
```

## 三、R3：模块顶层裸 let 收编

### 3.1 现状

模块顶层 `let` 89 处（排 test/cli/dist），形态三类：

- **懒初始化单例**：`let textEncoder: TextEncoder | null | undefined`（common/encoding.ts:8）——双检锁懒建
- **进行中标志**：`let orphanGcInFlight = false`、`let startupMaintenanceRan = false`
- **可换注册槽**：`let activeAccelerator = null`、`let defaultPushMutex = null`、`let registeredSseTransport`、`let defaultSink`（log/logger.ts:51）

### 3.2 判据与形态

用户裁决：**离散可变变量不该裸露，应由对象管理**。收编形态：

- 模块内 `let` 且与同文件 namespace/对象共生 → 收进该 namespace 的私有闭包槽（`const X = { get current() {...}, set(v) {...} }` 或既有 `createCallbackSlot` 族）。
- 跨模块消费的可变槽（`defaultSink`、`registeredSseTransport`）→ 单例 holder object（对齐既有 `createRebootWaiterSlot` 的 arm/claim/settle 风格），**导出面只暴露操作不暴露变量**。
- **模块级 `const` 单例**（`export const maintenanceBusy = createBusyFlag()`）已算对象管理，**不动**。
- 纯函数内局部 let 不在范围。

### 3.3 验收

```
- 新 grep 门（进 nm-style：模块顶层 let = 0，豁免进 baseline）
- 每处收编不改行为：懒初始化仍是双检、标志位语义逐字不变
- 三端测试绿
```

## 四、R4：拼接 SQL 迁 SqlTemplate（底座已存在）

### 4.1 关键事实

`packages/core/src/infra/sql-template/` **已完整实现**（`docs/Iterations/SqlTemplateParser/spec.md` 的五标签 `<if>/<foreach>/<choose>/<where>/<set>`、`#{}` 绑定、`${}` 受信插值、AST 两阶段）。tdbc 已消费（`#{id}` 绑定先例）。

### 4.2 范围与判据

全仓 62 处 `` `SQL...${...}` `` 插值，分两桶：

- **A 桶（迁 `<if>`）**：动态条件拼接——`usage-stats.service.ts` 的 `modelFilterSql`/`providerFilterSql`/`timeRangeSql` 三函数及其消费点（:173/:220/:277 等手拼 WHERE）。迁成：

  ```sql
  SELECT ... WHERE <if test="model != null"> model = #{model}</if>
                <if test="providerId != null"> AND provider_id = #{providerId}</if>
  ```

  三函数退役，`${}` 手拼消除。
- **B 桶（保留 `${}`）**：表名/常量插值（`${TABLE}`、`${SMART_SORT_RULE_TABLE}`）——受信任标识符，parser 原生支持，**不改**（迁 `<if>` 反而画蛇添足）。

`align-schema-columns.ts:27` 的 `pragma_table_info('${alignment.table}')` 属 B 桶（PRAGMA 参数不支持绑定，保留）但**必须加受信注释**。

### 4.3 验收

```
- A 桶：modelFilterSql/providerFilterSql/timeRangeSql grep=0
- usage-stats 全部测试绿（数字逐字对齐——SQL 重写不许改结果）
- 新增模板用例覆盖：全 null / 单条件 / 双条件 / 边界时间
```

## 五、R5：SQL 常量格式化

### 5.1 现状

29 个 `const XXX_SQL = ...` 常量，被 nm style 一行规则压平：最长 1061 字符（top5：1061/565/386/370/368）。

### 5.2 方案

1. **规则层**：nm-style `check-signatures` 对「模板字面量赋值给全大写 `_SQL` 后缀常量」**豁免一行要求**（多行 SQL 文本合法）——豁免写进规则说明与 SKILL.md，不是 known-false-positives 逐条登记（29 条逐条登记太脆）。
2. **代码层**：29 个常量重排为多行 SQL（关键字引导换行、缩进两格）；**逐字节重排后语义等价**——执行者对每个常量跑前后 SQL 解析对拍（SqlTemplateParser.parse 输出同一 AST / 或 tdbc conformance 测试绿）。
3. 禁止顺手改 SQL 逻辑；发现疑似行为差异即停手上报。

### 5.3 验收

```
- check-signatures 对 _SQL 常量不再报；豁免逻辑有单测
- 29 个常量全多行；tdbc-conformance + usage-stats 测试绿
```

## 六、R6：UI 硬编码文案 i18n 深化

### 6.1 现状

硬编码双引号中文（≥2 字）1440 处：mobile 862 / desktop 578（排 test/dist）。既有机制：`settingsTranslator({key})` + zh/en 双 catalog（`#243`：descriptor 形态才查表，裸字符串直通——迁移必须用 descriptor）。

### 6.2 分桶与判据

| 桶 | 处置 |
|---|---|
| UI 展示文案（按钮/标题/提示/菜单） | **迁**：键名 `ui.<screen>.<element>`，双 catalog 补齐 zh（现文案逐字）+ en 翻译 |
| 错误/校验消息 | **迁**：走既有 `error.*` 段（码表 messageKey 机制） |
| 日志/调试/console 文本 | **不迁**（日志不做本地化） |
| 测试断言字符串 | **不迁**（改断言会虚化验证） |
| 平台无 catalog 的 webview 层 | 先盘消费链再定（webview 的 translator 注入路径与 native 不同，可能需要桥接）——**探针先行** |

### 6.3 执行

1440 处量大，按屏分片（mobile 按路由、desktop 按 feature 目录），每片自带 catalog 补丁；**文案逐字锁**（#242：整句片段锁，防双端漂移）。探针（波 0）先产出：每片文件数/处数 + webview translator 可用性结论。

### 6.4 验收

```
- UI/错误桶硬编码中文 grep=0（日志/测试桶豁免并登记口径）
- 双 catalog 双向覆盖断言绿（zh 有键 en 必有，占位符 ⊆ params——沿用 app-error.test 同款断言）
- 双端切语言冒烟：en 环境无中文残留（抽 20 屏人工核）
```

## 七、R7：renderer signatures 自判收敛

### 7.1 裁决授权（用户拍板：由执行 agent 自己判断）

desktop/renderer 374 条 signatures findings（renderer 此前不在旧 check-style 扫描面，nm-style 扩面后首次可见）。**不预设「豁免 vs 全适用」**——执行 agent 逐类定性、自己裁决边界、然后执行自己裁决的清法。

### 7.2 形态盘点（执行者先读这个）

| verdict | 条数 | 典型形态 |
|---|---|---|
| VARDECL | 119 | `const [workspacePrompt, setWorkspacePrompt] = useState(...)` 解构声明 |
| ARGS | 140 | JSX 回调/事件处理实参跨行（`onClick={() => ...}` 链） |
| PARAMS | 100 | 组件 props 解构 / hook 形参多行 |
| IMPORT | 9 | 多具名导入 |
| ASSIGN | 6 | 赋值 RHS 跨行 |

### 7.3 判断框架（授权但给锚点，防一刀切）

逐类产出三列裁决表：`形态 | 判定（豁免/收一行）| 理由`，判断锚点：

- **豁免候选**：React 生态惯用且一行化会伤可读性的——`useState` 解构若 RHS 本身要拆行、深嵌 JSX 内联回调、组件 props 解构（一行塞不下是常态）。nm-code-style 的一行规则本意为**逻辑代码可读性**，不是逼 UI 代码对齐。
- **收一行候选**：与 React 无关的纯 TS 逻辑行（工具调用、`const x = fn(a, b)` 被无谓拆行）——这些与 core 同规则，该收。
- **两不管**：import 合并（IMPORT 9 条）按 nm style 既有 import 规则处理。

**硬约束**：裁决表先出后动码；豁免判定必须落进 nm-style 的规则层（`SKIP` 机制或 known-false-positives），不是口头豁免——否则 gate 永远红；清理不得与 prettier 默认宽度冲突（#244/#275：不跑全局 prettier，改完用 `--print-width 200` 自检）；裁决与执行同一 agent 闭环，收尾交 `--changed` 自检数字。

### 7.4 验收

```
- 裁决表落 docs/apm/memory（形态 × 判定 × 理由）
- 豁免进规则层；收一行桶清零
- nm-style check desktop/renderer --changed 无新增；三端测试绿
```

## 八、执行编排

```
波 0  探针四路并行：R1 定性表（29 UNTRIAGED）/ R2 139 类定性表 / R6 webview translator 可用性 / R7 renderer 裁决表（374 条逐形态判定）
波 1  R1 修复 ∥ R4 A 桶迁移 ∥ R3 收编（三线文件零交集）
波 2  R2 收编（依赖波 0 定性）∥ R5 规则豁免 + 重排 ∥ R7 收一行桶执行（依赖波 0 裁决表）
波 3  R6 分片迁移（依赖波 0 探针；量最大，允许超出本 tag 单独收）
波 4  收敛：typecheck + 三端 + nm-style 五段 + throw-audit gate + dup-gate + renderer 裁决表生效
波 5  tag p27-backlog（R6/R7 未完则 tag 写明对应 partial 项）
```

分片纪律（#277）：每片确定文件清单；R4 与 R3 有同文件风险（usage-stats.service.ts 既有裸 let 又有拼接 SQL）——R4 先动、R3 后动；R7 与 R6 都动 renderer 但文件集不同（R7 全 renderer、R6 按屏），R7 先出裁决表并落规则层后 R6 才动 renderer 文件。

## 九、明确不做

- `apps/cli`（#276）；接口实现 class 的端口契约改造（p17 V4 已裁保留）；B 桶受信 `${}` 表名插值；测试断言文案；日志文案 i18n。
- 不改任何 SQL 查询语义；不动 `SqlTemplateParser` 本体（除非探针发现五标签能力缺口——那是新迭代）。

## 十、风险

| 风险 | 缓解 |
|---|---|
| R2 误收接口实现 class | 定性表先出，收编桶必须同时满足「无 implements + 无共享字段」 |
| R3 懒初始化改坏双检锁 | 收编形态保语义：holder 的 getter 内保留原双检结构逐字 |
| R4 SQL 重写改结果 | usage-stats 数字测试逐字对齐是硬门；对不上即停 |
| R5 豁免规则被滥用到非 SQL | 豁免只认 `_SQL` 后缀 + 模板字面量 + 全大写常量三条件 |
| R6 双端文案漂移 | #242 整句锁 + 收口时镜像段逐字 diff |
| R6 量大拖 tag | 允许 R6 单独 partial，tag 注明 |
