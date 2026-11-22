# p27 R6 波 3-2d 片 D3：desktop 工作区/统计/更新关于 i18n 迁移（2026-11-21）

任务：键面已全立（keys.ts ui.* 1127 键），本片只做组件替换、绝不碰注册面。
范围：desktop SettingsViews 全文件 + 工作区 vfs 段 + 统计段 + 更新/关于段。
前序先例：D1（shell 域）、D2（config 域），形态沿 D1/D2 记忆文件。

## 形态要点（沿 D1/D2）

- `coreT({key: "ui.x.y", params: {...}})`（import `@shared/logic/core-i18n`），键必须包 descriptor。
- fallback 三元保持结构只换字面量；composed 拼接句用标签键拼；数据默认值（`"—"`）不迁。
- 每键写前 grep generated-catalog.ts 验同文——**编造键两次险些发生**（models_saved_title /
  rest_fill_filename 均不存在，靠 grep 拦下）。

## commit 链（7 个）

- f69945a11 SettingsViews 部分 1/2；cbfe10cd1 SettingsViews 收尾 2/2（中断恢复后按调整纪律
  先 diff 核对再 commit、每 2-3 文件一 commit）。
- 0fd49e1c4 契约锁回退：provider tab `label: "服务商配置"/"模型管理"` ← provider-detail-tabs.test.ts；
  数据清理 desc 模板「当前库体积 ${」「可回收约 ${」← settings-db-maintenance-ui.test.ts。
- 5416dc7d8 工作区 vfs 1/2（actions/batch-dnd/context/HeaderActions）；e82518f9f vfs 2/2
  （WorkspaceTree/DirectoryRuleModal/FileInclusionModal/ImportFormModal/PreviewAnnotateUi）。
- 26fb70d49 统计段（TokenUsageStatsView 全量 + MetricsDetailPopover 核查）。
- 8c4e58b90 更新/关于段（UpdateAvailableModal/UpdateCheckResultModal/AboutView）。
- 56819b9f2 修 JSX 语法错：coreT params 嵌套少写一层 `}`（2 处）→ token-usage-stats-view.test.tsx
  挂（esbuild TransformError，tsc 竟绿——**JSX 内嵌套对象括号靠 tsc 查不住，必须跑测试**）。
- e891dee55 nm-style 内联：键化常量改闭包触发 3 个 INLINE_CANDIDATE，内联归零。

## 对号表外借键（波 3c 待裁决）

- ui.nav.settings_smart_sort 借作 DirectoryRuleModal 排序字段「智能排序」（域标签语义偏差）。
- label.workplace.display.filename 借作 FILL_POLICIES filename 项「文件名」。
- ui.stats.slice_aria 借作 TokenUsageStatsView 饼图展示详情行（aria 键用于展示行，模板同形）。
- ui.stats.chart_calls_aria 借作当天汇总行「调用 {n} 次」片段。

## 源码契约测试锁（保留原字面量，波 3c 对齐测试后迁）

settings-db-maintenance-ui.test.ts 锁面比预期宽：`title="确认清理"` **和** message 正文
「耗时随库体积增长」都锁正则——cleanup_confirm 两键虽在键面（cleanup_confirm_title_desktop /
cleanup_confirm_desktop），迁移必红，整弹窗保留。settings-agents-tabs 锁「内置/全部/查看/
通用助手 · 不可编辑/主子智能体 label」；settings-agents-delete-confirm 锁 named 删除确认
「删除 Agent/服务商/模型「x」？」；smart-sort-rules-view 锁空态两句+规则校验三条。

## 漏键清单（保留字面量待波 3c 补键）

SettingsViews：「请选择起止日期」×2、「开始日期不能晚于结束日期」（range_start_after_end 不同文）、
「已删除 ${count} 个 Agent」模板、「已保存模型」「已更新模型名称」「新建 Agent」「智能体作用域」、
「暂无主/子智能体，点击上方按钮创建。」（list_*_empty 键文不同）、「确认拉取」「云端较新」两弹窗
title+message、「清理」按钮、「配置已失效，请先修复后再复制/重命名」「API Key 状态」「API Key 将通过
SKSP 安全存储」「新 API Key（留空则不修改）」「Secret Access Key（留空则不修改）」「Path style
（MinIO / 部分 OSS）」「请填写服务商名称」「服务商名称不能为空」「新建服务商」「重命名服务商」
named 删除确认「(空匹配)」半角 vs no_match_text 全角不同文、「禁用」「新建规则」「恢复默认规则」
「正则无效：${}」「启用规则」「请输入测试文本」「请先填写正则表达式」「{day} · 按小时分布」
「会话累计」、「无效操作」×3「选择文件失败」（unknown_action 是「未知操作」不同文）「拖出失败」×2
「导出物化失败」×2、zip/card 导入三 hint、「批注操作」aria、「segment index 越界」、「统计数据
返回格式异常」×2。

## 工作区并行片边界

FileMarkdownPreview/CloudSyncProgressPanel/cloud-sync-progress-ui 是 mobile M3 文件（desktop
无对应物），按纪律未碰；M3 三文件（VfsFileManager/FileEditorScreen/StorageConfigScreen）commit
时精确列文件排除。

## 验证

desktop typecheck 主 tsconfig 绿；desktop npm test 774/774 全绿（基线 774）；nm-style 16 文件
显式扫描（--changed 在 worktree 失效）：dup FIND +3 组经 f69945a11^ 基线对拍为存量、hygiene
修复后与基线持平；清单内文件非注释中文残留全部归类（契约锁/漏键/不同文），归零达成（豁免有据）。

## 教训

- commit message 的已迁键清单要与 diff 实况一致——f69945a11 message 列了 cleanup_confirm 两键
  但 diff 实未迁（中断恢复核对不细）；后续靠测试锁面确认「保留字面量反而是对的结果」。
- esbuild 与 tsc 对 JSX 语法错口径不同：params 嵌套括号错 tsc 放行、esbuild 挂，测试跑的是
  esbuild 转换——typecheck 绿不等于测试绿，两者都要跑。
