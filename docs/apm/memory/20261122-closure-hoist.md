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
