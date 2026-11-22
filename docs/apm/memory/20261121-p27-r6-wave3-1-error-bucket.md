---
date: 2026-11-21 00:00
title: p27 R6 波 3-1：mobile/desktop 错误桶迁移（组件层 error.* 键对号——实际可迁点仅 2 处，其余全部缺键记清单）
keywords: p27, R6, 波 3-1, 错误桶, i18n, ERROR_MESSAGE_KEYS, 缺键清单, toast 标题, VfsErrorForUser, AppError descriptor
abstract: 波 3-1 盘点 mobile（apps/mobile/src 排 web/测试）与 desktop（renderer 764 行中文 + shared 105 行）组件层错误语境中文（错误语境词 grep ≈300 行 + catalog 188 键中文片段双向反搜）。结论：A 桶 187 键的原始抛错点在 core（G1.x 已 descriptor 化），组件层剩余错误文案几乎全是 toast 标题/表单校验/基建 throw，在 ERROR_MESSAGE_KEYS 无键。实际迁移仅 2 处：mobile vfs-character-card.service buildTooLargeError → error.vfs.character_card_too_large.input（core character-card-import.service.ts:296 同键同参先例；消掉 formatVfsErrorForUser 兜底意外的「操作失败：」包裹层，与 core 同键行为对齐）、cloud-sync.service INVALID_STATUS detail → error.cloud_sync.invalid_status.unparseable（core coordinator.ts:444 同款；CLOUD_SYNC 域走 visibleMessage 逐字不变）。desktop 零可迁（shared config-forms 4 条校验 message 与 renderer toast/校验全缺键）。缺键清单落报告波 3-2 统一补。验证：双端 typecheck 绿、nm-style check --changed PASS（dup +1 为第 0 片已登记 mermaid.ts 既有欠账，本片实际消除 1 组重复）、desktop 测试绿、mobile 测试结果见正文。
---

user（波 3-1 任务书，2026-11-21）：在 worktree p27-backlog 执行错误桶迁移：组件层硬编码中文错误文案与 ERROR_MESSAGE_KEYS 187 键对号，逐处替换为取译调用；缺键不自立键，记清单波 3-2 补；分片 commit（mobile/desktop 各一片）；验证双端 typecheck + 三端测试（pre 钩子 build core 放行）；归零自检（引号无关，提示词/日志/注释/CSS content 豁免）。

assistant（盘点 + 迁移 + 验证，2026-11-21）：

盘点方法（双路径交叉）：①错误语境词 grep 引号内中文（mobile 1494 行原始 → 错误语境 298 行；desktop shared 105 行 + renderer 764 行 → 错误语境 ≈80 行）逐段人工定性；②zh-CN.yaml error 域 188 键抽中文片段（去插值、≥4 汉字段）反搜组件层。二者合并结论一致。

结构性发现（对波 3-2 有复用价值）：A 桶 187 键的原始位置在 core 抛错点（validate-agent-definition、vfs 校验器、error-codes 码表、cloud-sync coordinator 等），G1.x 已完成 descriptor 化——组件层经 FormatError.format / format-ipc-error → visibleMessage → coreT 通道消费，天然无硬编码残留。组件层剩余错误文案三类全部缺键：①ToastMessage.toast('标题', err) 标题（加载失败/删除失败/保存失败/导入失败/操作失败/创建失败/设置失败/检查失败/导出失败…约 150 处，mobile 为主）；②表单校验 showToast('{X}不能为空') 类（两端 ≈40 处）；③基建 throw（polyfills/webview-host/db-file-path/mobile-sksp，诊断文案非用户文案）。

迁移 2 处（均为 AppError detail → descriptor，形态照抄 core 先例）：
- apps/mobile/src/services/vfs-character-card.service.ts buildTooLargeError：`{detail: \`角色卡文件过大：…\`}` → `{descriptor: {key: 'error.vfs.character_card_too_large.input' as const, params: {size_bytes, limit_bytes}}}`。core 同键先例 character-card-import.service.ts:296（bytes.length 闸门）。行为说明：原 detail 版无 messageKey，formatVfsErrorForUser 对码表无短码的 TOO_LARGE 走 operationFailed(message) 兜底，用户看到「操作失败：角色卡文件过大：…」双层前缀，而 core 同键路径无此前缀——迁移消掉这个双路径漂移，两端同文案。这是迁移应有效果，非文案回归。
- apps/mobile/src/services/cloud-sync.service.ts:105 CLOUD_SYNC_INVALID_STATUS：`{detail: '云端状态文件无法解析'}` → `{descriptor: {key: 'error.cloud_sync.invalid_status.unparseable' as const}}`。core 先例 coordinator.ts:444。CLOUD_SYNC 域走 Errors.visibleMessage（userOf 沿 cause 链查 messageKey）→ coreT，用户可见逐字不变。

desktop 零可迁：shared/config-forms/agent-editor-state.ts 4 条校验 message（请填写 Agent 名称/请填写常驻工作区助手确认语/至少保留一个 Prompt 块/专属模型须为已保存模型的 UUID，与 mobile 镜像）+ renderer App.tsx/features toast 与校验 ≈45 处全缺键 → 无 desktop commit（纪律：缺键不迁，波 3-2 统一补）。

协议依赖跳过案例（重要，别在波 3-2 踩）：map-cloud-sync-sdk-error.ts:56 `message.includes('请先配置云存储')` 是错误归一判据（依赖 buildS3StorageConfig / pull / push 三处 detail 的字面文本流动）——迁这三处必须同步改匹配协议（改 code 判定），超出文案迁移范畴，整组跳过。

验证：mobile/desktop typecheck 绿（pre 钩子 build core 放行）；nm-style check --changed PASS（dup 同名 +1 为第 0 片已登记的 mermaid.ts vs render-dir-attach-tree.ts 既有欠账，web 禁碰区非本片引入；本片实际消除 1 组同形态重复）；desktop npm test 绿；mobile npm test 结果见波 3-1 报告（pretest build core + webview 钩子放行后全量跑）。
