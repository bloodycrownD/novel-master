# CR Fix Spec: workspace-chat-vfs-upgrade

## 元信息
- repo: `d:\Dev\Js\novel-master`
- base_sha: `42ea5bfb43e03cedf9103e19bb1400532a125d55`（merge-base main）
- head_sha: `cf97e096438240459efb56b87a54d9c58d215a47` + **working tree**（含 Mobile 单文件 IO 简化、db-backup 大文件导入、Desktop drag toast）
- prd_path: `.apm/kb/docs/Iterations/workspace-chat-vfs-upgrade/prd.md`
- spec_path: `.apm/kb/docs/Iterations/workspace-chat-vfs-upgrade/spec.md`（及 `features/*/prd.md|spec.md`）
- review_round: 2
- dag_version: 3
- 状态：fix-spec-ready

## Must-fix（按 P0 → P1 → P2）

### f3/g-01 [P1] ZIP directoryPath 指向 file 应 INVALID_PATH
- 维度：G
- 文件：`packages/core/test/vfs/vfs-zip-io.test.ts`
- 问题：缺少「`directoryPath` 指向 file 节点 → `INVALID_PATH`」的测试覆盖。
- 改法：在 export/import 路径各补一条用例，或参数化覆盖「directoryPath 为 file」场景；断言错误码为 `INVALID_PATH`。
- 验收/测试：`vfs-zip-io.test.ts` 全绿；新用例可稳定复现并断言 `INVALID_PATH`。
- 来源：review round 1 / f3

### f4/desktop-export-staging-leak [P1] Desktop 导出 staging 目录泄漏
- 维度：A / G
- 文件：Desktop `vfs-batch` staging（`apps/desktop/src/main/services/vfs-batch.service.ts` 及相关 drag 生命周期）
- 问题：拖出导出后 `stagingRoot` / `stagedByPath` 未在 `dragEnd` 或 TTL 到期时清理，staging 目录可能无限增长。
- 改法：在 drag 结束（`dragEnd` / 取消 / 失败）及 TTL 超时路径中，统一清理 `stagingRoot` 与 `stagedByPath` 条目；避免重复注册未回收的 staging 句柄。
- 验收/测试：多次 Desktop 拖出导出后，staging 临时目录不持续累积；手动或单测验证 drag 结束/TTL 后目录被删除。
- 来源：review round 1 / f4

### f4/desktop-drag-prefetch-race [P1] prefetch in-flight 时 dragstart 静默失败
- 维度：A / G
- 文件：workspace DnD（Desktop VFS 拖拽入口，prefetch 与 `dragstart` 协调处）
- 问题：prefetch 仍在进行时触发 `dragstart`，当前无用户反馈，表现为静默失败。
- 改法：prefetch in-flight 时拦截或延迟 drag，并向用户展示 toast（说明正在准备/请稍后再拖）；避免无提示失败。
- 验收/测试：prefetch 进行中尝试拖拽时可见 toast，不再静默失败；prefetch 完成后拖拽正常。
- 来源：review round 1 / f4

### f4/mobile-toast-failed-field [P1] Mobile 批量失败 toast 字段错误
- 维度：A
- 文件：`apps/mobile/src/services/vfs-batch.service.ts`
- 问题：失败导入 toast 误读 `failed[0]?.error`；core `BatchApplyReport.failed` 项为 `{ path, message }`（无 `error` 字段），导致 toast 回退「未知错误」或为空。**working tree 当前仍误用 `.error`**（见 `formatImportToast`）。
- 改法：toast/摘要须用 `failed[0]?.message`（与 `BatchApplyReport` 对齐）；禁止 `.error`。
- 验收/测试：故意触发 batch 失败时，Mobile toast 显示真实 `message` 文案。
- 来源：review round 1 / f4；**wave2 修正字段语义**（review round 2）

### f4/desktop-windows-drag-icon [P1] Windows 拖出 icon 空图硬崩主进程
- 维度：A / G
- 文件：`apps/desktop/src/main/services/vfs-batch.service.ts`（`startDragExport` / `resolveDragIcon`）
- 问题：HEAD 使用 `nativeImage.createEmpty()` 作为 drag icon；Windows 上 `startDrag` 会硬崩主进程（try/catch 无效）。working tree 已有 `resolveDragIcon`（app icon → 1×1 PNG fallback）**尚未 commit**。
- 改法：合入/保留 `resolveDragIcon`（`resolveAppIconPath` → resize；否则 `createFromBuffer(FALLBACK_DRAG_ICON_PNG)`）；**禁止** `createEmpty()`。
- 验收/测试：Windows 拖出不崩主进程；drag 失败路径仍 toast（行为不变）。
- 来源：review-full round 2 / f4

### f4/doc-mobile-single-file-narrow [P1] Mobile VFS IO 文档收窄（下游改业务 PRD/SPEC）
- 维度：A（文档 / IA）
- 文件：
  - `features/vfs-batch-io/prd.md`
  - `features/vfs-batch-io/spec.md`
  - 父级 `.apm/kb/docs/Iterations/workspace-chat-vfs-upgrade/prd.md` 中 Mobile 批量 IO 相关行
- 问题：业务文档仍描述 Mobile「批量导入/导出、多选导出当前目录全部」等能力，与实现 IA 不一致（Mobile 已收窄为单文件导入/导出；目录级操作为 ZIP）。
- 改法（**由下游执行，本 wave 不直接改业务文档**）：
  1. Mobile 导入/导出：明确为**单文件**；移除「批量导入/导出」「无多选导出当前目录全部」等验收条目。
  2. 目录级：导入/导出统一为 **ZIP** 语义；写清 `saveDocuments` / 平台文件选择器限制（无法 pick 文件夹等）。
  3. 菜单/文案：与单文件 IA 一致（无 folder-pick、无 multi-export 当前目录全部）。
  4. **Desktop 拖拽批量**行为保持不变，文档中单独保留 Desktop DnD 批量说明。
  5. 父 PRD 交叉引用处同步删改 Mobile 批量表述，避免与 feature spec 冲突。
- 验收/测试：上述 PRD/SPEC 与当前 Mobile/Desktop 实现 IA 一致；QA manual_user 中 Mobile 路径不再引用已删除的批量验收。
- 来源：review round 1 / f4；用户口头确认 Mobile 单文件收窄

### f1/C-orch-1 [P2] fork-copy-parity reposFor 与 helper 自建 repo 二选一
- 维度：C-orch
- 文件：`message` / `session` / `seed-fork-copy-parity` 相关 orchestration（reposFor 注入 vs helper 内自建 repo）
- 问题：`reposFor` 作为死字段传入与 helper 内部自建 repo 两套路径并存，易导致 parity 行为不一致或维护分叉。
- 改法：二选一收敛——要么统一经 `reposFor` 注入全部 repo，要么 helper 内唯一来源自建；删除未使用的另一路径并更新调用方。
- 验收/测试：`fork-copy-parity` 与相关 session/message 测试仍绿；无重复 repo 构造逻辑。
- 来源：review round 1 / f1

### f1/G-1 [P2] fork-copy-parity copy 分支补 sortOrder 断言
- 维度：G
- 文件：`fork-copy-parity.test.ts`（及同迭代 fork copy 测试）
- 问题：copy 分支测试未断言 `sortOrder` 复制/保留是否正确。
- 改法：在 copy 分支用例中补充 `sortOrder` 期望值断言（与 spec 中 fork/copy parity 规则一致）。
- 验收/测试：对应测试绿；copy 路径 sortOrder 回归可被测试捕获。
- 来源：review round 1 / f1

### f2/desktop-settings-model-no-footer-reload [P2] 设置变更后 token 页脚未刷新
- 维度：B / C
- 文件：Desktop `ShellNavProvider` / settings 与 agent config 通知链
- 问题：`notifyAgentConfigChanged` 触发后 token 页脚未随 model 设置更新而 reload，页脚仍显示旧配置。
- 改法：在 config 变更通知路径调用 `reloadFooter`，或让页脚订阅 config revision 自动重载。
- 验收/测试：修改 model/settings 后 token 页脚三源展示与当前配置一致，无需手动刷新页面。
- 来源：review round 1 / f2

### f2/test-max-steps-cache-clear [P2] max_steps 变更应清 API token cache
- 维度：G
- 文件：`agent-runner-token-cache.test.ts`（及 runner cache 实现若需对齐）
- 问题：缺少「`max_steps` 变更清除上一轮 API cache」的测试覆盖。
- 改法：补测试：变更 `max_steps` 后断言 token/API cache 已 clear；若实现缺失则先补实现再测。
- 验收/测试：新用例绿；与 PRD/SPEC 时序一致（见 Open questions 若仍有歧义）。
- 来源：review round 1 / f2

### f2/desktop-tt9-missing [P2] Desktop chat-prompt-tokens 缺 T-T9
- 维度：G / C
- 文件：Desktop `chat-prompt-tokens` 相关测试/实现
- 问题：测试矩阵缺 T-T9 场景（token 页脚/overlay 三源之一），覆盖不完整。
- 改法：按 feature spec 补 T-T9 用例（Desktop 路径）；实现若未覆盖则同步补齐。
- 验收/测试：T-T9 用例绿；与 token 页脚三源 QA 项一致。
- 来源：review round 1 / f2

### f3/g-02 [P2] 空 ZIP 导入非根子树应保留目录行
- 维度：G
- 文件：`packages/core/test/vfs/vfs-zip-io.test.ts`
- 问题：空 ZIP 导入到非根 `directoryPath` 子树时，未断言目录行（空文件夹占位）被保留。
- 改法：补 import 用例：空 ZIP + 非根目标路径，断言 VFS 保留对应目录节点/目录行。
- 验收/测试：`vfs-zip-io.test.ts` 绿；行为与 ZIP 子树 spec 一致。
- 来源：review round 1 / f3

### f3/c-orch-01 [P2] Mobile 导出 ZIP 文件名应对齐 Desktop（含 directoryPath 后缀）
- 维度：C-orch
- 文件：`apps/mobile/src/services/vfs-zip.service.ts`（及 Desktop 对照实现）
- 问题：Mobile 导出 ZIP 默认文件名未含 `directoryPath` 后缀，与 Desktop 命名不一致。
- 改法：Mobile 导出命名规则对齐 Desktop（basename + directoryPath 后缀或同等语义）；跨端文档/QA 描述一致。
- 验收/测试：Mobile 导出 ZIP 文件名含预期后缀；与 Desktop 同路径导出可对照。
- 来源：review round 1 / f3

### f4/desktop-blank-mime-move [P2] Desktop 空白区接受 MIME 移动到根
- 维度：A / G
- 文件：Desktop workspace VFS DnD（空白区 drop / MIME move 处理）
- 问题：空白区域未正确处理 MIME move 到 `/`（根），拖放/move 行为缺失或错误。
- 改法：空白区作为 drop target 接受 MIME move，目标路径为 `/`；与树内 move 规则一致并补测试或手动 QA 步骤。
- 验收/测试：文件拖到 VFS 空白区可 move 到根；无静默丢弃。
- 来源：review round 1 / f4

### f4/mobile-import-silent-fail [P2] Mobile read 失败勿假「导入完成」
- 维度：A
- 文件：Mobile VFS 导入路径（batch/单文件 read 失败处理）
- 问题：read 失败时仍向用户展示「导入完成」或成功态，造成 silent fail。
- 改法：read 失败时中断流程，toast/结果态为失败并携带错误信息；不得标记为成功完成。
- 验收/测试：模拟 read 失败时 UI 显示失败且无成功 toast；与 f4/mobile-toast-failed-field 联调可读。
- 来源：review round 1 / f4

### f4/core-ingest-type-conflict [P2] planBatchIngest 检测 file/dir 类型冲突
- 维度：A
- 文件：core `planBatchIngest`（VFS batch ingest 规划）
- 问题：同一批次 ingest 中 file 与 directory 类型冲突时未检测/未报错，可能导致错误写入或 silent corruption。
- 改法：在 `planBatchIngest` 阶段检测路径类型冲突（同一路径或互斥路径 file vs dir），返回明确错误码/错误项。
- 验收/测试：单测或集成测覆盖冲突批次；失败项结构可供上层 toast 展示。
- 来源：review round 1 / f4

## Spec deviations

| ID | 描述 | 状态 |
|----|------|------|
| SD-mobile-single-file-io | Mobile 单文件导入/导出；目录级 ZIP；无 multi-export / no folder-pick / 菜单文案与实现一致 | **fixed**（`31d20586` 文档收窄 + Mobile 实现） |
| SD-mobile-no-multi-export | 移除「多选导出当前目录全部」等产品表述 | **fixed** |
| SD-mobile-no-folder-pick | Mobile 无文件夹 pick；平台 `saveDocuments` 限制写入文档 | **fixed** |
| 其他 | — | none |

**下游文档同步：** 已由 `f4/doc-mobile-single-file-narrow` 在 code-dev-loop 闭合。

## Open questions / 待拍板

| 域 | 问题 |
|----|------|
| F2 | 新 run 是否应 clear 上一轮 API cache（PRD vs SPEC 时序表述是否一致） |
| F4 | staging TTL / prefetch UX / db-backup 修复是否同 PR 合并范围 |
| F1 | CI 能否稳定跑通 `fork-copy-parity`（环境/fixture 依赖） |
| F3 | basename 误拒边界（Spec 已定，产品接受；实现与测是否需额外边界用例） |

## 已豁免（用户确认不修）

（本轮无新增豁免条目）

## 合并后 QA（manual_user）

- **F1** fork：规则灯 + 回滚路径可用
- **F2** token：页脚三源（含 model 变更后刷新）正确
- **F3** ZIP：子树导入/导出（含空 ZIP 非根目录、directoryPath 后缀文件名）
- **F4 Desktop**：拖入 / 拖出 / 树内 move / 空白区 move 到根；staging 不泄漏；prefetch 中 drag 有 toast
- **F4 Mobile**：单文件导入/导出 + ZIP 目录包；失败 toast 可读；read 失败不假成功

## K 节建议（下游执行时闭合）

- 合并前跑 lint/format（仓库标准命令）。
- **勿**将 `mobile-chat-composer-annotate-ux` 迭代下未跟踪文档纳入本 PR。
- **db-backup OOM 修复**若与 working tree 同 PR，在 PR 描述中注明 **out-of-iteration**，与 workspace-chat-vfs-upgrade 验收范围分开说明。
