---
date: 2026-09-19 21:40
title: 桌面端 e2e 批次 B2：v1.5.17 智能排序四例回归（smart-sort-basic / sort-rule-manager / subdir-sort / filename-validation）
keywords: desktop, e2e, 智能排序, smart sort, 目录规则, 排序方式, 文件名校验, SettingsSection, ReferenceError, crash, run-all, B2
abstract: B2 批次为 v1.5.17 智能排序功能补四例桌面端 Playwright _electron 回归：智能排序 DOM 顺序（中文数字/阿拉伯/混排、序章置顶、番外沉底、无序号自然序沉底、同序号文件名决胜）全 PASS；设置→智能排序管理页列表/启停/恢复默认/内置不可删全 PASS，但编辑页（SmartSortRuleEditorView）打开即抛 ReferenceError: SettingsSection is not defined——SettingsViews.tsx L2176/L2246 用了 <SettingsSection> 而 import 列表没有（v1.5.17 tag 同码，非 worktree 回归），React 树整棵崩溃白屏，编辑/新建/正则测试三场景被阻断记产品缺陷；子目录排序遵循目录规则（名称 locale 序≠卷序 / 创建时间=mtime / 智能排序=卷序数值）+「排序方式」文案更名全 PASS；文件名校验：./.. toast「文件名不能为 . 或 ..」PASS、纯空白被弹窗禁用提交（验证层文案不触达，OBS）、首尾空格名被 TextPromptModal 提交前静默 trim 短路（" xx " 直接以 "xx" 创建、无拒绝提示，与 CHANGELOG 声明不符记产品问题）。脚本侧沉淀：toast 可见窗口仅 ~0.5s（DOM 移除极快）→ 文本断言以 DOM 轮询为准、截图零延时 best-effort；fixed 定位右键菜单/设置行菜单在小视口（1280x800）贴底溢出 → DOM el.click() 直触发；Switch 原生 checkbox 隐藏 → 点 label；名称排序 localeCompare 实测 zh 拼音序（二<三<十<一）非码点序，跨 locale 断言不可硬编码。
---

user:
你是 novel-master 桌面端 e2e 回归的用例开发执行者（批次 B2：v1.5.17 智能排序功能）。……（四个功能点 + 交付要求：case 文件、截图 840-869、run-all 登记 B1 四例、commit、报告）

assistant:
执行记录（关键决策与发现）：

【代码定位】智能排序 UI：目录规则弹窗 DirectoryRuleModal（.dir-rule-modal，chips=文件名称/创建时间/更新时间/智能排序，active=.config-dep-chip.is-active）；管理页入口 设置→高级→智能排序（[data-settings-nav="smartSortRules"]）；内置七条规则在 packages/core/src/bootstrap/smart-sort-rule/builtin-smart-sort-rules.ts（序章/开篇 fixed_min、终章/收尾+番外/外传 fixed_max、中文卷章复合/中文序号章节/英文章节/数字序号开头 smart）；排序比较器 core smart-sort.ts compareSmartBasenames 全序五条（有序号<无序号沉底、fixed_max=[∞] 也是序号故排在无序号前、同序号 compareNatural 决胜、desc 全反）；树行走 workplace-rule-engine walkDir（目录先于文件、子目录用父目录规则排序=SD 场景）。文件名校验 validate-entry-name.ts 中文文案四条 + workspace-actions 前置校验（不发 IPC）。

【产品缺陷①（严重）】设置→智能排序→点任意规则或「新建规则」→ pageerror "ReferenceError: SettingsSection is not defined" → React 树整棵崩溃、界面白屏（appAlive=false）。根因：SettingsViews.tsx 的 SmartSortRuleEditorView 用 <SettingsSection>（L2176/L2246）但 from "./settings-ui" import 列表缺这一项；vite/esbuild 不做类型检查故 dev 也能跑列表页（只有编辑页渲染时才炸）。git 确认 v1.5.17 tag 同码（f2a02361 引入），HEAD 与 tag 对这两个文件零 diff——即 1.5.17 发布版就带着这个雷。修法=import 列表补 SettingsSection（未修，按任务只记录）。case 侧对策：编辑页三场景放 case 末尾做 crash 探针（截图 857 白屏证据 + pageerror 断言），自定义规则改由 python3 sqlite3 预写 smart_sort_rule 表（better-sqlite3 是 Electron ABI 用不了，系统 python3 的 sqlite3 可用；sort_order=100 挂内置之后）保住 恢复默认/删除 两场景。

【产品缺陷②】首尾空格文件名 " xx "：TextPromptModal（v1.4.21 起就有的 trim 逻辑）提交前 value.trim()，校验层「文件名不能以空格开头或结尾」永不可达——实际以 "xx" 静默创建、无任何提示，与 CHANGELOG「拒绝并即时提示」不符。纯空白名则被弹窗 canSubmit=false 拦（确定禁用、无文案）→ 拒绝成立但提示形态是禁用按钮（OBS）。只有 "."/".." 走通 toast「文件名不能为 . 或 . .」（重命名同）。

【通过面】SS 全 PASS（名称序基线第10章<第2章 → 智能排序后 序章,第1章,第一章,第2章,第10章,番外,大纲——番外[∞]在大纲(null)前，无序号沉最底）；SD 全 PASS（名称 locale 序实测拼音序「第二卷,第三卷,第十卷,第一卷」≠卷序；创建时间=mtime 创建序；智能排序=第一卷,第二卷,第三卷,第十卷；表单文案「排序方式」非「排序字段」）；SR-LIST/TOGGLE/BUILTIN-NODELETE/RESET/DELETE 全 PASS（禁用番外/外传后工作区 番外探.md 沉入自然序、启用恢复 fixed_max 前置——启停行为变化经真实树验证；内置行菜单无删除项；恢复默认=禁用的内置复活+预置自定义保留+toast 已恢复默认规则）。

【脚本侧坑（都不是产品问题）】① toast 可见窗口 ~0.5s（.shell-toast 从 DOM 移除极快，fixed 于标题栏下方 top+10px）——文本断言用 60ms 轮询 DOM 必中；视觉截图是竞态（page.screenshot 耗时≈toast 整个生命期），best-effort 零延时。② 视口 1280x800 偏小：固定定位的右键菜单/设置行菜单（.context-menu、#workspace-context-menu）贴底行的菜单项「outside of the viewport」不可点——统一 el.evaluate(el=>el.click()) DOM 触发（处理器纯 onClick 无坐标依赖）+ 右键前 scrollIntoView({block:"center"})。③ Switch 组件原生 checkbox 样式隐藏，check()/uncheck() 必超时——点 .settings-switch label。④ 面板空白右键在树上内容变多后会命中文件行（菜单无 create-folder）——根域新建改右键根目录行「/」。⑤ 名称排序 localeCompare 本机 zh 环境实测拼音序，跨 locale 断言只能断「≠卷序」不能硬编码具体序。⑥ 管理页各 step 不假设设置开闭态：ensureRulesPage() 幂等归位（设置未开则开、无规则行则点导航）。

【序列结果】run-all 16 脚本（原 8 + B1 四 + B2 四）：13 PASS；FAIL=sort-rule-manager（设计内：3 编辑页场景记产品缺陷）、filename-validation（设计内：FV-SPACE 记产品问题）、empty-dir-rename（B1 用例序列负载下 ER-GHOST 时序 flake——改名后 1300+900ms 内树未刷完就读文件行，单跑复测全 PASS，非产品问题）。console/pageerror：全序列仅 case-models-skills 2 条预存嵌套 button hydration warning（非本批）+ SR-MGR 的 SettingsSection ReferenceError（产品缺陷①）。

【提交】scripts/e2e 四个新 case + run-all.mjs（SCRIPTS 补 B1 四例与 B2 四例）；out/ 截图按仓库惯例（scripts/e2e/.gitignore 忽略 out/、B1 亦未强行 add）不入库，报告列文件名清单。YAML 导入导出走原生文件对话框标 🔧 跳过。
