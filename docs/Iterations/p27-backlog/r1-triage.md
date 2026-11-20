# p27 R1 探针：UNTRIAGED throw 站点逐处定性表

- 范围：`scripts/throw-audit-baseline.json` 中 disposition=UNTRIAGED 的 28 条静态站点 + `tools/nm-style/src/lib/symbols.ts:614`（动态报告、不在 baseline 静态清单）1 条 = **29 处**。
- baseline 里的 symbols.ts:678 实际已随静态清单入库（spec 描述有偏差），动态独有的只有 614 一条；29 = 28 + 1，与 gate 数字一致。
- 方法：live 跑 `node tools/nm-style/bin/nm-style.mjs throw-audit`（180 站点）与 baseline 逐条对拍，再读每处函数级上下文与调用链定性。
- live 审计机判参考：cloud-sync desktop 三处 + mobile db-backup:141 判 VIOLATION（函数已 Result 签名）、desktop db-backup:168 判 BOUNDARY、其余多为 VIOLATION-B（工具未识别「事务回调抛错回滚 + 边界转码」链路）。

## verdict 分布

| verdict | 处数 | 说明 |
| --- | --- | --- |
| 改 return | 5 | SettingsViews:1349、cloud-sync(desktop) 124/127/129、db-backup(mobile):141 |
| BOUNDARY | 23 | 进程入口 1、React hook 守卫 7、native bridge 1、既定 throw 通道设计 1、编程错误不变量 2、事务回滚通道 10、nm-style CLI 不变量 2 |
| KEEP | 1 | 测试夹具断言（webview-mock:113，补 `nm-throw: keep` 注释对齐既有族） |

## spec 特别点名项核对结果

| spec 点名 | 现状 | verdict |
| --- | --- | --- |
| `message.service.ts:262`（createAbortError） | 现树为 `packages/core/src/service/chat/impl/message.service.ts:262` 的 `throw AbortError.create()`（fork 边界）。T2（createAbortError）形态被审计**完全豁免**（live 输出 T2=0），事务内 314/331 已 ALLOWED。**不在 29 处 UNTRIAGED 内。** | 既定事务回滚机制，不动 |
| `session.service.ts:309` | 现树 :309 是 `copy()` 里的 `throw AbortError.create()`，同样 T2 豁免。UNTRIAGED 清单里真正在的是同文件 **:209**（deleteSessionTree），见主表 #22。 | :309 既定豁免；:209 BOUNDARY + delete() 边界补转码 |
| `export-database-backup.ts:41` | `packages/core/src/infra/db-backup/export-database-backup.ts:41` = `throw AbortError.create()`（导出取消信号，doc 注释明言「平台协议例外：Promise 无 Result 通道，由各端边界转 Outcome.cancelled / IPC_ABORTED」）。baseline 无此条、live 不报。 | 既定 T2 豁免，不在 29 处内 |
| mobile 4 处入口检查点 | 即 mobile 4 处 `useX must be used within Provider` hook 守卫（ChatTabNavContext:47 / HeaderContext:53 / novel-master-context:418 / ThemeProvider:96）。 | 全部 BOUNDARY（编程错误不变量，见主表 #10–13） |
| renderer `throw new Error`（参数校验类） | 唯一一处为 `SettingsViews.tsx:1349`（自定义参数必须 JSON 对象）；校验失败目前 throw→catch→toast，**不静默**。 | 改 return（本地提前 return + toast，见主表 #1） |
| `tools/nm-style/src/lib/symbols.ts:614/678` | nm-style 自身 CLI 工具内部「symbol 不属于本索引」不变量。 | 全部 BOUNDARY（工具进程边界，见主表 #28–29） |

## 主表（29 处）

| # | file:line | 函数名 | 当前形态 | verdict | 理由 | 修复要点 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | apps/desktop/renderer/features/settings/SettingsViews.tsx:1349 | `submit` 内本地 `parseBodyParams` | T4 `new Error("自定义参数必须是 JSON 对象")`；UI 事件处理器本地控制流 | 改 return | 参数校验失败不该靠 throw 跳外层 catch 再转 toast；校验失败必须可见（现有 toast 通道保留） | `parseBodyParams` 改返回 Result（或内联校验），失败分支 `toastSettingsError(...)` + 提前 return，删除该 throw；如需对齐错误码语义可用 `AppError("INFRA_VALIDATION_FAILED")`，UI 层以 toast 收口，不静默 |
| 2 | apps/desktop/renderer/main.tsx:8 | 模块顶层（bootstrap） | T4 `new Error("Missing #root element")` | BOUNDARY | 进程入口装配不变量：index.html 缺 `#root` 属宿主装配错误，启动期无 Result 通道可返回 | 登记 baseline 理由；不改代码 |
| 3 | apps/desktop/renderer/providers/NovelMasterProvider.tsx:158 | `useNovelMaster` | T4 React hook 守卫 | BOUNDARY | Provider 外调用 hook 属编程错误；渲染期同步返回值无 Result 通道（desktop/mobile 7 处同族同判） | 登记 baseline |
| 4 | apps/desktop/renderer/providers/ShellNavProvider.tsx:1001 | `useShellNav` | T4 React hook 守卫 | BOUNDARY | 同 #3 | 登记 baseline |
| 5 | apps/desktop/renderer/providers/ThemeProvider.tsx:84 | `useTheme` | T4 React hook 守卫 | BOUNDARY | 同 #3 | 登记 baseline |
| 6 | apps/desktop/src/main/services/cloud-sync.service.ts:124 | `DesktopCloudSyncService.testConnection` | T3 `AppError("CLOUD_SYNC_AUTH")`，catch 内裸 throw；函数已是 `Promise<Result<void, AppError>>` | 改 return | 签名已是 Result，catch 内裸 throw 让已知域失败穿透 Result 通道（live 判 VIOLATION） | :124/:127/:129 三处 `throw new AppError(...)` 改 `return Result.err(new AppError(...))`；catch 内 return 即函数出口，签名与调用方均不变 |
| 7 | apps/desktop/src/main/services/cloud-sync.service.ts:127 | 同上 | T3 `AppError("CLOUD_SYNC_NETWORK")`（网络类） | 改 return | 同 #6 | 同 #6 |
| 8 | apps/desktop/src/main/services/cloud-sync.service.ts:129 | 同上 | T3 `AppError("CLOUD_SYNC_NETWORK")`（兜底 message） | 改 return | 同 #6 | 同 #6 |
| 9 | apps/desktop/src/main/services/db-backup.service.ts:168 | `replaceLiveDatabase`（私有，`Promise<void>`） | T3 `AppError("INFRA_UNEXPECTED_ERROR")`（导入失败且回滚失败） | BOUNDARY | 替换链（备份→关连接→覆盖→恢复三表）按 :194 注释**整体保持 throw 通道**：`DatabaseReplacedError` 必须以异常类型跨 `importFromPath` 抵达 IPC handler（handlers/cloud-sync.ts:155 instanceof 判定、cloud-sync.service.ts:272 记账分支）；仅把回滚双失败一处改 Result 会造成同函数混合双通道 | 登记 baseline 理由；不改代码（live 机判同为 BOUNDARY） |
| 10 | apps/mobile/src/navigation/ChatTabNavContext.tsx:47 | `useChatTabNavigation` | T4 React hook 守卫（另有 `useChatTabNavigationOptional` 弱版本并存） | BOUNDARY | 同 #3；严格版即刻意的强不变量入口 | 登记 baseline |
| 11 | apps/mobile/src/navigation/HeaderContext.tsx:53 | `useHeaderContext` | T4 React hook 守卫 | BOUNDARY | 同 #3 | 登记 baseline |
| 12 | apps/mobile/src/runtime/novel-master-context.tsx:418 | `useNovelMaster` | T4 React hook 守卫 | BOUNDARY | 同 #3 | 登记 baseline |
| 13 | apps/mobile/src/theme/ThemeProvider.tsx:96 | `useTheme` | T4 React hook 守卫 | BOUNDARY | 同 #3 | 登记 baseline |
| 14 | apps/mobile/src/services/db-backup.service.ts:141 | `importFromPath`（已 `Promise<Result<DbImportOutcome, AppError>>`） | T3 `AppError('INFRA_UNEXPECTED_ERROR')`（回滚双失败），catch 内裸 throw | 改 return | catch 内裸 throw 穿透 Result 签名；同函数上方 :89–90 已有 `Result.err(INFRA_VALIDATION_FAILED)` 先例；调用方 mobile cloud-sync.service.ts:194 按 `imported.ok` 消费 | :141 改 `return Result.err(new AppError('INFRA_UNEXPECTED_ERROR', ...))`；`DatabaseReplacedError`(:127) 与 `throw error`(:145) 保持 throw 通道（换代信号按既定设计以异常类型上行，mobile cloud-sync:401 接住）；`finally` 释放互斥不受影响 |
| 15 | apps/mobile/src/services/rn-file-io.ts:45 | `RnFileIo.blobFs`（同步，返回 fs 模块本体） | T3 `AppError('INFRA_UNSUPPORTED_PLATFORM')` | BOUNDARY | native bridge 依赖装配边界：react-native-blob-util.fs 未注入属平台能力缺失（同 LlmSseNative/sksp 的 keep 族先例）；返回值即 fs 模块，Result 化会毒化全部调用点 | 登记 baseline；如需与 keep 族形态统一可补 `// nm-throw: keep — ...` 注释 |
| 16 | apps/mobile/test-utils/react-native-webview-mock.tsx:113 | `findMockWebViewByDomain`（测试夹具） | T4 `new Error("WebView mock 未找到域…")` | KEEP | 测试夹具定位失败须以异常打断测试，无 Result 消费方；对齐既有族（tdbc-conformance suite.ts:178、vfs-batch-io:239、vfs-zip-io:212） | 源码补 `// nm-throw: keep — 测试夹具断言：定位不到 mock 实例必须打断测试，非业务错误。`，随后 `--write-baseline` 落盘 |
| 17 | packages/core/src/domain/tool/logic/tool-registry.ts:26 | `ToolRegistry.register`（void） | T3 `AppError("TOOL_CONFLICT")` | BOUNDARY | 装配期编程错误不变量：同名重复注册属 bug（类注释明言 safer than last-wins）；调用方仅 bootstrap 装配（register-builtin-tools 固定清单）与同源复制（resolve-agent-tools） | 登记 baseline |
| 18 | packages/core/src/domain/vfs/content-store/impl/sqlite-vfs-content-store.ts:273 | `SqliteVfsContentStore.ensureBlob`（`Promise<string>`） | T3 `AppError("VFS_CONTENT_BLOB_MISSING")` | BOUNDARY | blob 缺失且无回退明文=数据受损域失败；消费方均在事务回调内（restore-path 持 tx、vfs-tree-copy replaceSubtree/Outcome 边界转 createAbortError、seed 链），抛错即回滚，service 边界 `unwrapTxDomainError` 收进 Result.err | 登记 baseline；若日后出现事务外 Result 消费方再议 port 签名 Result 化 |
| 19 | packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-entry.repository.ts:682 | `renamePrefixInScope`（端口 vfs-entry.port.ts:210 即 `Promise<void>`） | T3 `AppError("VFS_NOT_FOUND")`（幽灵路径） | BOUNDARY | 幽灵路径按既定设计抛错回滚：唯一消费链 `renamePrefix`（revision-aware-vfs.service.ts:273）注释明言「repo 抛 VFS_NOT_FOUND」，边界已 `unwrapTxDomainError` 转 Err | 登记 baseline；不改代码 |
| 20 | packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:271 | `adjustRefCount`（`Promise<void>`） | T3 `AppError("VFS_NOT_FOUND")`（单条缺失） | BOUNDARY | 守护 T-RB-REF-MISSING 不变量；消费方 RevisionRefCount.adjust 链全部落在事务回调内，抛错回滚 + service 边界转码 | 登记 baseline |
| 21 | packages/core/src/domain/vfs/repositories/impl/sqlite-vfs-revision.repository.ts:297 | `batchAdjustRefCountWithDelta`（`Promise<void>`） | T3 `AppError("VFS_NOT_FOUND")`（批量缺失聚合） | BOUNDARY | 同 #20（批量 +1 前置存在性校验，ref_count 不得悬空） | 登记 baseline |
| 22 | packages/core/src/service/chat/impl/session.service.ts:209 | `deleteSessionTree`（private，`Promise<void>`，tx 闭包内递归） | T3 `AppError("CHAT_NOT_FOUND")`（根行删除落空） | BOUNDARY（边界转码缺口） | tx 回调内必须靠抛错回滚——此处改 `return Result.err` 会在「子树已删、根删失败」时**提交半删事务**；但外层 `delete()`(:161，Result 签名) 未接 `unwrapTxDomainError`，CHAT_NOT_FOUND 目前以异常穿透 Result 契约 | :209 throw 保留；`delete()` 的 `conn.transaction` 调用外包 try/catch + `unwrapTxDomainError` → `return Result.err(domain)`（对齐 revision-aware-vfs delete/resetHead 的 RB4b 边界转码）；此缺口随波 1 一并修 |
| 23 | packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:120 | `delete` 的 tx 回调 | T3 `AppError("VFS_NOT_FOUND")`（非递归删根不存在） | BOUNDARY | 方法注释明言「事务回调内失败靠抛错回滚（总纲 §五例外 2）」；方法边界已 `unwrapTxDomainError` 收进 Err（注释还记录了四期「裸 throw 穿透 Result 聚合」的 RB4b 教训） | 登记 baseline；不改代码 |
| 24 | packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:173 | `resetHeadToVersion` 的 tx 回调 | T3 `AppError("VFS_NOT_FOUND")`（entry 缺失） | BOUNDARY | 同 #23 | 登记 baseline |
| 25 | packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:179 | 同上 | T3 `AppError("VFS_NOT_FOUND")`（revision 缺失/已删） | BOUNDARY | 同 #23 | 登记 baseline |
| 26 | packages/core/src/service/vfs/impl/revision-aware-vfs.service.ts:182 | 同上 | T3 `AppError("VFS_NOT_FOUND")`（active revision 无内容） | BOUNDARY | 同 #23 | 登记 baseline |
| 27 | packages/core/src/service/vfs/impl/vfs-zip-io.service.ts:67 | `ensureEmptyDirectoryRow`（module-private，`Promise<void>`） | T3 `AppError("VFS_NOT_A_DIRECTORY")` | BOUNDARY | 函数 doc 明言「只在 import 段 B0 的 `conn.transaction` 回调内调用，失败靠抛错回滚」；import 外层 catch(:257) 收口，方法内 unwrapOrRollback 同款形态 | 登记 baseline；不改代码 |
| 28 | tools/nm-style/src/lib/symbols.ts:614 | `buildSymbolIndex.globalRefsOf`（闭包，`GlobalRefs`） | T4 `new Error("nm-style: symbol 不属于本索引")` | BOUNDARY | nm-style 自身 CLI 工具内部不变量：入参 symbol 必然取自同一索引，查不到=调用方编程错误；工具进程边界直接 throw 合理（spec 预判一致） | 登记 baseline（动态站点：baseline 静态清单不含本条，落盘时确认写入） |
| 29 | tools/nm-style/src/lib/symbols.ts:678 | `buildSymbolIndex.localRefsOf`（闭包，`LocalRefs`） | 同 #28 | BOUNDARY | 同 #28 | 登记 baseline（本条已在静态清单内） |

## 波 1 修复文件清单（改 return + 边界缺口，去重后 4 个）

1. `apps/desktop/renderer/features/settings/SettingsViews.tsx`（#1，本地校验控制流改提前 return + toast）
2. `apps/desktop/src/main/services/cloud-sync.service.ts`（#6–8，三处 catch 内 throw → `return Result.err`）
3. `apps/mobile/src/services/db-backup.service.ts`（#14，:141 throw → `return Result.err`）
4. `packages/core/src/service/chat/impl/session.service.ts`（#22，:209 throw 保留，`delete()` 边界补 `unwrapTxDomainError` 转码）

登记类（BOUNDARY 23 + KEEP 1）随波 1 一并以 `nm-style throw-audit --write-baseline` 落 baseline；KEEP 的 webview-mock:113 需先补 `// nm-throw: keep — ...` 源码注释。
