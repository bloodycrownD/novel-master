# p27 R6 波 3-2d 片 M3：mobile 内容/同步/统计/更新/关于段 i18n + web 两点接线（2026-11-21）

## 做了什么

mobile 内容域 UI 文案迁移到 `coreT({key: "ui.*"})` descriptor 通道，17 个源文件 + web 层两点接线。键面（packages/core/src/i18n keys.ts 1127 ui.* 键）不碰，注册面不碰，只做组件替换。分 7 个 commit 提交（每个 commit 前只跑 mobile typecheck 三段，全量 npm test 最后跑一次）。

- 1/3 vfs：VfsFileManager（~45 处）、FileEditorScreen（dd f1451cf）
- 2/3 存储配置：StorageConfigScreen（1890481e6）
- 3a 云同步：CloudSyncConfigScreen、CloudSyncProgressScreen、TemplatePush/PullButton（3423afbba）
- 3b 统计：TokenUsageStatsScreen、PieChart、StackedBars（3695fe93e）
- 3c 更新关于：UpdateCheckHost、UpdateCheckResultModal、AboutScreen（e9869abad）
- web 两点接线：mermaid overlay 关闭 aria-label + rich-document 超限提示（43be4dd8f）
- 契约锁回退片：VfsFileManager 12 处 + StorageConfigScreen 11 处 + factory optional call（1210c1075）

## web 两点接线形态（本片新学）

- **mermaid overlay 关闭按钮**：`MermaidViewerOverlay` props 加 `closeLabel?: string`（缺省 `'关闭'`），`mermaid-fullscreen.ts` 模块级 `closeLabelProvider` holder + 新增 `setCloseLabelProvider(fn)` 注入口，`mountPortal` 渲染时惰性取 `closeLabelProvider?.() ?? undefined`（晚到的 init.labels 也能生效）。chat-transcript 侧 factory 注入 `state.labels.ui['ui.common.close']`（第一桥），rich-document 侧 main.ts 注入 `RichDocumentBridge.currentLabels().ui['ui.common.close']`（第二桥）。
- **rich-document 超限提示**：删 `OVER_LIMIT_HINT` 常量 import，渲染处改 `RichDocumentBridge.currentLabels().ui['ui.rich_document.over_limit_hint']`——旧宿主/缺省由 `DEFAULT_RICH_DOCUMENT_UI_LABELS` 回退原常量文案，渲染值恒存在。
- **契约锁规避**：`mermaid-fullscreen.test.ts:80` 锁 `mountPortal: (portalId: string): void => {` 签名字面量 → 不改 mountPortal 签名（原方案给签名加 getCloseLabel 参数被锁死），改走独立 `setCloseLabelProvider` 方法 + 模块 holder。
- **factory 测试 mock 坑**：chat-transcript 工厂测试 jest.mock 的 MermaidFullscreen 是部分对象（无新方法），直接调用 `setCloseLabelProvider` 报 not a function → `?.()` optional call 兼容（生产模块恒有，注释写明原因）。

## 契约测试锁字面量 → 回退保留原中文（23 处，本片最大坑）

mobile 源码契约测试锁字面量的密度比 3-2c 更高，**迁移前应先 grep `__tests__` 里对该文件的 readFileSync 断言**，把锁定清单列出来再迁，能省一整轮回退：

1. `VfsFileManager.tsx`（vfs-character-card-menu.test.ts 锁 12 处）：导入/导出菜单常量、导入表单三项 items、三份导入确认文案（zipImportConfirmCopy/characterCardImportConfirmCopy/singleFileImportConfirmCopy 的中文模板串）、`'导入单文件', singleFileImportConfirmCopy(...)` Alert 形态、`'ZIP 导入完成'/'已导入角色卡'` 成功 toast、`'ZIP 已保存到所选位置'/'文件已保存到所选位置'` 导出 toast。
2. `StorageConfigScreen.tsx`（storage-config-screen-source.test.ts 锁 11 处）：`title="存储空间"` 等 5 个 JSX 裸字面量顺序锚点（indexOf 靠引号形式定位，`title={coreT(...)}` 也算破坏锚点）、`label: '库体积'/'可回收'`、`cloudConfigured ? '已配置' : '未配置'`、`Alert.alert('数据清理'`、`ToastMessage.toast('清理失败', err)`（正则锁；另一处 result.error 版一致性回退）、`` `清理完成：${before} → ${after}` ``。
3. 全部回退处带注释「nm-style/契约：xxx.test 锁…波 3c 对齐后再迁」，集中在 1210c1075。

## 漏键清单（键面无对应键，保留原中文，不自立键）

- VfsFileManager：`选中项含受保护路径：${blocked[0]}`（batch 阻断 toast 无键）
- CloudSyncConfigScreen：`hint="MinIO 可留空"`、`label="Region"`（英文标签未迁）
- CloudSyncProgressScreen：`推送成功`（push_done=「推送完成」字面不同，不硬凑）
- TemplatePushButton：`text: '推送'`（pull_action/sync_action 有键，push_action 无）
- PieChart 详情行「用量」「占比」标签（chart_calls_aria 有键已迁，两标签无独立键）
- MermaidViewerOverlay `closeLabel = '关闭'` 缺省值：接线设计（labels 未下发时的回退），非漏迁

## 非本片口径（记报告不处理）

FileEditorScreen 4 处 `throw new Error('缺少 projectId')` 等——错误通道（AppError detail/throw），不在 UI 文案迁移范围。

## 验证

- comm 校验：`grep -hoE 'coreT\(\{key: "[^"]+"'` 提取已用键 vs keys.ts 提取键，CRLF 需 `tr -d '\r'` 归一——迁移键全合法零自立键（首轮 169 假红就是 CRLF）。
- nm-style：worktree 里 `--changed` 失效，显式传 18 文件清单从仓库根执行；基线对照用 `git worktree add --detach` + 主仓绝对路径 CLI，hygiene 27=27、dup +3/-1 与基线完全一致后 `git worktree remove --force` 清理。
- mobile typecheck 三段（tsconfig.build / src/web / e2e:tsc）每 commit 前跑，全绿。
- 全量 npm test 最后一次：2382/2384，2 红均为既有（transcript-labels + chat-conversation-webview），与波前基线一致，零新增红。
