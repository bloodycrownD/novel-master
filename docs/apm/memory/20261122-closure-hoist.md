# p29 闭包提取轮（closure-hoist）与 SQL 文本排版豁免

## 起因
用户要求把 nm-style 的 nested-closures 检测做成规则（`closures` 子命令），找出函数内命名闭包，
评估退化/转换为普通方法/函数以提高复用性；随后又要求提取后按 nm style 全规范复审
（冗余 / 抽工具 / 合并）。中途用户指出 SQL 被单行规则压扁（sqlite-session-run-state.repository.ts:55
958 字符单行），要求豁免 + 重排。

## 交付（tag `p29-closure-hoist`，HEAD 28b2bc8d8）
1. **nested-closures 规则**（46e064886 + 5b8ad61b5）：`nm-style closures` 五桶分类
   （hoist/method/method+params/parametrize/parametrize-shared），全仓 454 处；检测器三处
   噪声修正（属性访问键位/解构声明/内层箭头形参）。
2. **W1 提取轮**（1989368a9）：五路只读探针定性 156 非渲染层站点（keep 45 / 改 111）→
   五片工作流并行改码 → 收敛。closures 454→301→296（非渲染层残余 0）。
3. **W2 错误域收编**（84d8d2905）：`unwrapTxDomainError` 归位 `ErrorGuards`（4 文件 4 种漂移
   形态收编——vfs 私有函数 / session 内联 / rollback 深度循环 / skills instanceof rethrow）；
   `TOOL_CONFLICT` 悬空码 7 处退役。
4. **SQL 排版豁免**（fb637cffb）：signatures 规则加 `SQL_HEAD_RE` 内容豁免（VARDECL/ASSIGN）
   + E5 ARGS 位豁免；全仓 298 处 SQL 模板重排为 R5 风格（子句关键字断行、列清单逗号断行、
   `${...}` 插值占位符保护）；测试基建 `countBySubstring`/特征匹配加空白归一。
5. **W3 复审收敛**（28b2bc8d8）：dup 裁决合并 1 组 + baseline 登记（95+141，gate PASS）；
   四维审必做 3 + 建议 5 全落地——SsePostSettle/SignalView namespace 收编、`FrontMatter.formatField`、
   `Coerce.nonEmptyText` 双端对齐、`Kkv.setJson`、`Arrays.pushIfAbsent`（新 common/arrays.ts）、
   `AbortScopeFactory.bailedInterrupt` 四站点收敛（desktop bailed / mobile isBailed 假镜像真重复）、
   nested-closures 双胞胎 walker 合并。

## 硬教训
- **工作流 stdout 256KB cap 第 3 次**：mobile jest 全量输出超 cap 杀死收敛步——五片报告 salvage
  完整，收敛改主会话直跑。工作流里跑测试必须 `--quiet` 或输出重定向文件。
- **`world.run` 无 cwd 选项**（facade 只有 timeoutMs）：改 `node -e "process.chdir(...); await
  import('file:///...')"` 形式；nm-style bin 走 spawnSync 保 argv。
- **python heredoc 写正则**：`\b` 被 bash/python 双层转义吃成退格字符（`\x08`）——写正则类
  内容用 Edit 工具或 chr(92) 拼。
- **SQL 空白不敏感 ≠ 测试特征匹配空白不敏感**：`includes("not in (select ...")` 类特征在
  SQL 重排后失配——特征匹配 helper 必须先 `replace(/\s+/g, " ")` 归一。
- **dup 裁决与四维审冲突时的裁决**：双端「镜像」若函数体逐字相同且无平台差异参数 → 假镜像
  真重复，收敛优于登记 baseline（(shouldBail?) 组被 a1 收编即是）。
- **检测器作者第一案犯**：写 `collectBindingNames` 当天就留下 2 个违规命名闭包——新规则
  落地后立刻跑全仓，自己的新代码先过门。

## 终态数字
- closures 454 → 296（非渲染层 0；296 = renderer 141 + mobile-ui 155 用户裁定不动层）
- signatures=0、top-let=0、throw-audit PASS（UNTRIAGED 0）、dup gate PASS（95+141，+0/-0）、
  typecheck 15/15、core 960 / desktop 774 / mobile 2384 全绿
- SQL 模板全仓统一 R5 多行风格（298 处），`SQL_HEAD_RE`/E5 双豁免进 signatures 规则

## 后补：AbortError 通道收敛（w3b，805aed661，tag 移至本提交）
用户质询「AbortError 是 error（该收 AppError）还是控制流（该收 Outcome）」揭出两笔债并落地：
1. **T2 判据 namespace 化盲区**：throw-audit 只认旧名 `createAbortError()`，p23 工厂 object
   namespace 化（AbortError.create()）后 16 站点全量漏网——判据改双形态（isAbortFactoryText）。
   教训：**改名/namespace 化迁移必须同步迁移检测器判据的文本匹配**。
2. **VIOLATION 4 处 Outcome 化**：fork/copy（事务外检查点中断沿返回值上行，事务回调内 throw
   保持 P1）、export-database-backup.toPath（「Promise 无 Result 通道」理由不成立——签名自选）、
   mobile exportViaPicker/importViaPicker 入口检查点（返回 'cancelled'/'reloaded' 字面量）。
3. AbortError 定位写死在 create-abort-error.ts：**平台线格式，不是通道**——语义在通道两端表达
   （throw 点翻译自 Outcome 检查、catch 点转回控制流）。
4. 新坑：**async try-finally 裸 `return promise` 的 finally 先于 settle 执行**（release 提前放行
   busy，被 ic-20 busy 采样测试抓回）——try-finally 中必须 `return await`。

## 后补：SQL mapper 样板 + i18n 双轨收敛（ffbad2fa4 / 964cbab6e / a8a449982）
用户裁决 SQL 抽离（MyBatis XML 形态）与 i18n 双轨收敛同批落地：

### SQL mapper（样板 chat_message，18 条语句）
- 载体 `resources/sql/*.mapper.xml`（src 外 = Java resources 语义，tsc/nm-style 天然不扫）；
  生成器 `gen-sql-mapper.mjs`（fast-xml-parser preserveOrder）→ generated TS 进仓；
  运行时零文件读取、XML 不进 bundle。求值链路零改动（生成物原样进既有 SqlTemplateParser）。
- 动态标签（if/where/foreach/trim/choose）在 XML 里是**结构化元素**，生成器要还原成文本
  形态 `<if test="...">`（preserveOrder 的 childNodes 递归序列化）——XML 保留字符 `<=`
  写 `&lt;=`，解析器自动反转义，生成物是普通 SQL。
- `<sql id>` 片段 + `<include ref>` 展开解决列清单插值；INSERT 21 占位符写死（程序生成退役）；
  hiddenFilter 条件拼接收 `<if test>`（updateHiddenRange 改参数化 prevHidden）。
- 坑：python heredoc（<<'PYEOF'）在环境里会吃双反斜杠——**跨语言转义一律落临时 .py 文件
  再执行**（本段第三次踩）。

### i18n 双轨收敛（locales JSON 退役）
- 事实双轨：core 段走 yaml→gen-i18n-catalog→generated-catalog.ts；chat/settings 段是后加的
  手工 JSON（./locales exports）。收敛：JSON 并入 yaml（顶层 chat/settings 段）→ 生成器按
  前缀分拆三产物（CHAT_CATALOGS / SETTINGS_CATALOGS，as const）→ 双端 4 消费文件改道 →
  撤 ./locales exports → 删 4 JSON。
- 三个坑：
  1. **伪嵌套键**：`chat.rollback.confirm.backfill` 既是叶子又是 `.file`/`.tail.*` 的键前缀——
     YAML 真嵌套表达不了（同段叶子与子树并存），解法=段内扁平点分键（flatten 的 path 拼接
     天然支持键含点，生成器零改动）。
  2. **generated 产物别加显式宽注解**：`Readonly<Record<string, ...>>` 把 locale 字面量键
     宽化 → 下游 createTranslator 泛型推断塌 → mobile 测试组件 props 塌 never。域产物用
     `as const` 保推断强度。
  3. **域子路径只导出 CATALOGS**：createTranslator 在 @novel-master/core/common——mobile
     入口 import 错位（从域子路径 import createTranslator）会 TS2305。
- parseCore 跳过顶层域段（core 组装载器不管域键）；catalog.test 同步断言扩三组；键全集
  编译期断言（satisfies Record<ChatMessageKey,...>）——域 keys 联合与 yaml 键集实测完全同步。
