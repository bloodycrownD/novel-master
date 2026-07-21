---
createdAt: '2026-05-23 17:38:51'
updatedAt: '2026-07-21 00:48:30'
---
post-1.3.14-large-debt-remediation:
  prd: Iterations/post-1.3.14-large-debt-remediation/prd.md
  spec: Iterations/post-1.3.14-large-debt-remediation/spec.md
  prd_confirmed: yes
  spec_confirmed: yes
  execute_ready_confirmed: yes
  status: code-dev-loop in-progress
  branch: feature/post-1.3.14-large-debt-remediation
fork_rollback:
  preferred_fix: 每条消息同当前快照checkpoint+种revision+copyScope规则
  first_undo_send_empty: 可接受_不做seq0基线
  session_copy_parity: 与fork同合同
token_counting:
  preferred: 展示与压缩同一套引擎；有promptTokens用API否则本地；不新增api选项；禁止UI/压缩双轨
vfs_io_four_caps:
  zip_import: Mobile更多菜单; Desktop目录右键(待对齐)
  zip_export: Mobile目录项菜单子树导出; Desktop可对齐
  batch_import_export: Mobile更多菜单; Desktop拖入拖出+树内移动三者并存
  mobile_more: 批量导入/批量导出/导入ZIP
  mobile_dir_item: 仅导出ZIP
  desktop_dnd: 自定义MIME=VFS移动; Files=拖入导入; startDrag=拖出导出
  legacy_zip_prd: Iterations/vfs-zip-io-agent-tool-policy + import-export-navigation-fix = 整域全量替换
  zip_import_semantics: 当前目录子树覆盖_兄弟保留（用户确认）
prd_generate_terms:
  fork_snapshot: 分叉时挂当前活树快照到各消息checkpoint并保留session workplace规则
  batch_io: 非ZIP的本机多文件/文件夹导入导出（异于现网「批量操作」=规则/删除）
  zip_subtree: 相对当前目录或目录项的子树ZIP；导入仅覆盖该子树_兄弟保留
workspace-chat-vfs-upgrade:
  prd: Iterations/workspace-chat-vfs-upgrade/prd.md
  spec: Iterations/workspace-chat-vfs-upgrade/spec.md
  features:
    - fork-snapshot-and-rules
    - chat-token-api-overlay
    - vfs-zip-directory
    - vfs-batch-io
  prd_confirmed: yes
  spec_draft_confirmed: yes
  execute_ready_confirmed: yes
  status: code-dev-loop; branch feature/workspace-chat-vfs-upgrade
  branch: feature/workspace-chat-vfs-upgrade
  spec_points:
    fork: seedForkCopyParity同事务_取content再append
    token: resolve+sessionId+FINISHED仅completed写缓存_FAILED必clear
    zip: directoryPath子树_basename双前缀硬失败
    batch: Report整批回滚或逐文件_Mobile saveDocuments降级
  known_p2:
    - token clear勿仅挂publish FAILED门控
    - batch conflicts与skipped字段择一
  f1_impl: seedForkCopyParity+wire+T-F1..T-F6 done（含 projectId）


