# L0 IPC 全链路普查（ipc census）

> 机位：确定性普查（机械比对，不手抄）。
> 脚本：`tmp/l0census/ipc-census.mjs`（可复跑：`node tmp/l0census/ipc-census.mjs`）。
> 全集：`apps/desktop/shared/ipc-types.ts` 的 `IPC_CHANNELS`，共 **155** 条（invoke 型 148 / push 型 7）。

## 五层口径

| 层 | 判定方式 |
|---|---|
| ① 注册 | `apps/desktop/src/main/ipc/handler-registry.ts` 里出现 `bindNoArg/bindReq/bindBool/bindEventReq(IPC_CHANNELS.KEY, …)` 或 `ipcMain.on(IPC_CHANNELS.KEY, …)` |
| ② handler 实现 | 从绑定语句第二个实参取 handler 标识符，回 `apps/desktop/src/main/**` 找 `export function/const/class <name>` 的定义文件；内联箭头记 `inline` |
| ③ invoke 封装 | `apps/desktop/renderer/ipc/invoke-registry.ts` 里 `propertyName: …(invoke, IPC_CHANNELS.KEY)` |
| ④ client 导出 | `renderer/ipc/client.ts` 的 `export const { … } = invokeClient` 解构列表，或 `export function onXxx(…IPC_CHANNELS.KEY…)` |
| ⑤ renderer 消费 | 在 `renderer/**`（排除 client.ts / invoke-registry.ts）里 grep 该封装名或订阅函数名的调用点，排除 import/注释行 |

> push 通道（main → renderer）没有 invoke 侧，链路改为四段：**① main 生产（`webContents.send(IPC_CHANNELS.KEY)`）→ ② 转发器在 `main.ts` 接线（`set*ForwardTarget` / `attach*Forwarder` 被调用）→ ③ `client.ts` 订阅封装（`export function onXxx`）→ ④ renderer 消费**。

## 摘要

| 指标 | 数量 |
|---|---|
| IPC_CHANNELS 全集 | 155 |
| invoke 型 | 148 |
| push 型（main → renderer） | 7 |
| **全链路贯通（无断链）** | **143** |
| **有断链** | **12** |
| ⑤ 层无 renderer 消费（含仅测试引用） | 10 |
| renderer → main 的 `ipcMain.on` send 型通道 | 1（VFS_START_DRAG） |

## 一、invoke 通道 × 五层

| 通道 | KEY | ① 注册 | ② handler 实现 | ③ invoke 封装 | ④ client 导出 | ⑤ renderer 消费 | 断链 |
|---|---|---|---|---|---|---|---|
| `nm:bootstrap/status` | `BOOTSTRAP_STATUS` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:bootstrap/rebootstrap` | `BOOTSTRAP_REBOOTSTRAP` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:agent/activity/get` | `AGENT_ACTIVITY_GET` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:scope/get` | `SCOPE_GET` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:scope/setProject` | `SCOPE_SET_PROJECT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:scope/setSession` | `SCOPE_SET_SESSION` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:projects/list` | `PROJECTS_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 9 处 | — |
| `nm:projects/create` | `PROJECTS_CREATE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:projects/rename` | `PROJECTS_RENAME` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:projects/delete` | `PROJECTS_DELETE` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:projects/getAgentConfig` | `PROJECTS_GET_AGENT_CONFIG` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:projects/updateAgentConfig` | `PROJECTS_UPDATE_AGENT_CONFIG` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:sessions/listByProject` | `SESSIONS_LIST_BY_PROJECT` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:sessions/create` | `SESSIONS_CREATE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sessions/rename` | `SESSIONS_RENAME` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:sessions/delete` | `SESSIONS_DELETE` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:sessions/getComposerDraft` | `SESSIONS_GET_COMPOSER_DRAFT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sessions/setComposerDraft` | `SESSIONS_SET_COMPOSER_DRAFT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sessions/projectComposerStatus` | `SESSIONS_PROJECT_COMPOSER_STATUS` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:sessions/getAgentBinding` | `SESSIONS_GET_AGENT_BINDING` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:sessions/setAgentBinding` | `SESSIONS_SET_AGENT_BINDING` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sessions/setModelOverride` | `SESSIONS_SET_MODEL_OVERRIDE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:app-ui/get` | `APP_UI_GET` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:app-ui/set` | `APP_UI_SET` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/list` | `VFS_LIST` | ✅ | ✅ | ❌ | ❌ | ❌ 0 | ③ invoke-registry 未封装 |
| `nm:vfs/read` | `VFS_READ` | ✅ | ✅ | ✅ | ✅ | ✅ 5 处 | — |
| `nm:physical/list` | `PHYSICAL_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:physical/read` | `PHYSICAL_READ` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/write` | `VFS_WRITE` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:vfs/mkdir` | `VFS_MKDIR` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/delete` | `VFS_DELETE` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:vfs/rename` | `VFS_RENAME` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:vfs/zipExport` | `VFS_ZIP_EXPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:vfs/zipImport` | `VFS_ZIP_IMPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/zipPick` | `VFS_ZIP_PICK` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/zipImportBytes` | `VFS_ZIP_IMPORT_BYTES` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/characterCardImport` | `VFS_CHARACTER_CARD_IMPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/batchIngestFromPaths` | `VFS_BATCH_INGEST_FROM_PATHS` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:vfs/batchExportStage` | `VFS_BATCH_EXPORT_STAGE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/batchClearStaging` | `VFS_BATCH_CLEAR_STAGING` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:vfs/startDrag` | `VFS_START_DRAG` | ✅ | ✅ | ❌ | ❌ | ❌ 0 | ③ invoke-registry 未封装 |
| `nm:workplace/buildListRows` | `WORKPLACE_BUILD_LIST_ROWS` | ✅ | ✅ | ✅ | ✅ | ✅ 5 处 | — |
| `nm:workplace/setDirRule` | `WORKPLACE_SET_DIR_RULE` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:workplace/setFileRule` | `WORKPLACE_SET_FILE_RULE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:workplace/getDirRule` | `WORKPLACE_GET_DIR_RULE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:workplace/captureSessionBlock` | `WORKPLACE_CAPTURE_SESSION_BLOCK` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:sessions/pullTemplate` | `SESSIONS_PULL_TEMPLATE` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:sessions/pushTemplate` | `SESSIONS_PUSH_TEMPLATE` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:messages/list` | `MESSAGES_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:messages/append` | `MESSAGES_APPEND` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:messages/edit` | `MESSAGES_EDIT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:messages/hide` | `MESSAGES_HIDE` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:messages/show` | `MESSAGES_SHOW` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:messages/hideRange` | `MESSAGES_HIDE_RANGE` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:messages/showRange` | `MESSAGES_SHOW_RANGE` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:messages/truncateAfter` | `MESSAGES_TRUNCATE_AFTER` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:messages/delete` | `MESSAGES_DELETE` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:messages/fork` | `MESSAGES_FORK` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:messages/rollback` | `MESSAGES_ROLLBACK` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:messages/setFloor` | `MESSAGES_SET_FLOOR` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:messages/search` | `MESSAGES_SEARCH` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:agent/run` | `AGENT_RUN` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:agent/abort` | `AGENT_ABORT` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:agent/runIsActive` | `AGENT_RUN_IS_ACTIVE` | ✅ | ✅ | ✅ | ✅ | ✅ 5 处 | — |
| `nm:agent/resolveCurrent` | `AGENT_RESOLVE_CURRENT` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:agent/listPicker` | `AGENT_LIST_PICKER` | ✅ | ✅ | ✅ | ✅ | ✅ 5 处 | — |
| `nm:agent/setCurrent` | `AGENT_SET_CURRENT` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:model/listPicker` | `MODEL_LIST_PICKER` | ✅ | ✅ | ✅ | ✅ | ✅ 6 处 | — |
| `nm:model/setCurrent` | `MODEL_SET_CURRENT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:prompt/realPreview` | `PROMPT_REAL_PREVIEW` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:prompt/chatTokenLabel` | `PROMPT_CHAT_TOKEN_LABEL` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:prompt/agentMeta` | `PROMPT_AGENT_META` | ✅ | ✅ | ✅ | ✅ | ✅ 5 处 | — |
| `nm:compaction/manual` | `COMPACTION_MANUAL` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:preferences/getLlmStream` | `PREFERENCES_GET_LLM_STREAM` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:preferences/setLlmStream` | `PREFERENCES_SET_LLM_STREAM` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:preferences/getSubagentStream` | `PREFERENCES_GET_SUBAGENT_STREAM` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:preferences/setSubagentStream` | `PREFERENCES_SET_SUBAGENT_STREAM` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:preferences/getThinkingContext` | `PREFERENCES_GET_THINKING_CONTEXT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:preferences/setThinkingContext` | `PREFERENCES_SET_THINKING_CONTEXT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:providers/list` | `PROVIDERS_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 7 处 | — |
| `nm:providers/get` | `PROVIDERS_GET` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:providers/create` | `PROVIDERS_CREATE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:providers/edit` | `PROVIDERS_EDIT` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:providers/delete` | `PROVIDERS_DELETE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:providerModels/savedList` | `PROVIDER_MODELS_SAVED_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 6 处 | — |
| `nm:providerModels/fetch` | `PROVIDER_MODELS_FETCH` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:providerModels/suggestList` | `PROVIDER_MODELS_SUGGEST_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:providerModels/save` | `PROVIDER_MODELS_SAVE` | ✅ | ✅ | ✅ | ✅ | ✅ 6 处 | — |
| `nm:providerModels/deleteSaved` | `PROVIDER_MODELS_DELETE_SAVED` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:providerModels/getSaved` | `PROVIDER_MODELS_GET_SAVED` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:providerModels/updateSettings` | `PROVIDER_MODELS_UPDATE_SETTINGS` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:providerModels/resetContextWindow` | `PROVIDER_MODELS_RESET_CONTEXT_WINDOW` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:providerModels/editSaved` | `PROVIDER_MODELS_EDIT_SAVED` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:agentRegistry/list` | `AGENT_REGISTRY_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:agentRegistry/get` | `AGENT_REGISTRY_GET` | ✅ | ✅ | ✅ | ✅ | ✅ 5 处 | — |
| `nm:agentRegistry/upsert` | `AGENT_REGISTRY_UPSERT` | ✅ | ✅ | ✅ | ✅ | ✅ 6 处 | — |
| `nm:agentRegistry/delete` | `AGENT_REGISTRY_DELETE` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |
| `nm:agentRegistry/createBlank` | `AGENT_REGISTRY_CREATE_BLANK` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:agentYaml/export` | `AGENT_YAML_EXPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:agentYaml/import` | `AGENT_YAML_IMPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:sort-rule/list` | `SMART_SORT_RULE_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:sort-rule/create` | `SMART_SORT_RULE_CREATE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/update` | `SMART_SORT_RULE_UPDATE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/delete` | `SMART_SORT_RULE_DELETE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/deleteBatch` | `SMART_SORT_RULE_DELETE_BATCH` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/setEnabled` | `SMART_SORT_RULE_SET_ENABLED` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/setEnabledBatch` | `SMART_SORT_RULE_SET_ENABLED_BATCH` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/move` | `SMART_SORT_RULE_MOVE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/reorder` | `SMART_SORT_RULE_REORDER` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/importRules` | `SMART_SORT_RULE_IMPORT_RULES` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:sort-rule/exportRules` | `SMART_SORT_RULE_EXPORT_RULES` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:sort-rule/resetDefaults` | `SMART_SORT_RULE_RESET_DEFAULTS` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/match` | `SMART_SORT_RULE_MATCH` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/yamlExport` | `SMART_SORT_RULE_YAML_EXPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:sort-rule/yamlImport` | `SMART_SORT_RULE_YAML_IMPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:skills/list` | `SKILLS_LIST` | ✅ | ✅ | ✅ | ✅ | ✅ 6 处 | — |
| `nm:skills/effective` | `SKILLS_EFFECTIVE` | ✅ | ✅ | ✅ | ✅ | ✅ 5 处 | — |
| `nm:skills/read` | `SKILLS_READ` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:skills/write` | `SKILLS_WRITE` | ✅ | ✅ | ✅ | ✅ | ✅ 5 处 | — |
| `nm:skills/edit` | `SKILLS_EDIT` | ✅ | ✅ | ✅ | ✅ | ❌ 0 | ⑤ renderer 无消费 |
| `nm:skills/toggle` | `SKILLS_TOGGLE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:skills/delete` | `SKILLS_DELETE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:skills/assert-create-name` | `SKILLS_ASSERT_CREATE_NAME` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:skills/update-info` | `SKILLS_UPDATE_INFO` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:compactionConditions/get` | `COMPACTION_CONDITIONS_GET` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:compactionConditions/set` | `COMPACTION_CONDITIONS_SET` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:backup/export` | `BACKUP_EXPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:backup/import` | `BACKUP_IMPORT` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:db/stats` | `DB_STATS` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:db/maintenance` | `DB_MAINTENANCE` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:cloud-sync/getConfig` | `CLOUD_SYNC_GET_CONFIG` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:cloud-sync/setConfig` | `CLOUD_SYNC_SET_CONFIG` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:cloud-sync/setEnabled` | `CLOUD_SYNC_SET_ENABLED` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:cloud-sync/testConnection` | `CLOUD_SYNC_TEST_CONNECTION` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:cloud-sync/getLocalStatus` | `CLOUD_SYNC_GET_LOCAL_STATUS` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:cloud-sync/pull` | `CLOUD_SYNC_PULL` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:cloud-sync/push` | `CLOUD_SYNC_PUSH` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:search/getConfig` | `SEARCH_GET_CONFIG` | ✅ | ✅ | ✅ | ✅ | ✅ 3 处 | — |
| `nm:search/saveEngineKey` | `SEARCH_SAVE_ENGINE_KEY` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:search/clearEngineKey` | `SEARCH_CLEAR_ENGINE_KEY` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:search/setSearxngBaseUrl` | `SEARCH_SET_SEARXNG_BASE_URL` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:search/setEngineOrder` | `SEARCH_SET_ENGINE_ORDER` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:shell/menuPopup` | `SHELL_MENU_POPUP` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:shell/setTitleBarTheme` | `SHELL_SET_TITLEBAR_THEME` | ✅ | ✅ | ✅ | ✅ | ✅ 1 处 | — |
| `nm:shell/openExternal` | `SHELL_OPEN_EXTERNAL` | ✅ | ✅ | ✅ | ✅ | ✅ 7 处 | — |
| `nm:usageStats/query` | `USAGE_STATS_QUERY` | ✅ | ✅ | ✅ | ✅ | ✅ 7 处 | — |
| `nm:app/getInfo` | `APP_GET_INFO` | ✅ | ✅ | ✅ | ✅ | ✅ 2 处 | — |
| `nm:app/checkForUpdates` | `APP_CHECK_FOR_UPDATES` | ✅ | ✅ | ✅ | ✅ | ✅ 4 处 | — |

### invoke 侧 handler / wrapper 明细

| KEY | handler | handler 定义文件 | registry 行 | invoke 封装名 |
|---|---|---|---|---|
| `BOOTSTRAP_STATUS` | `bindNoArg → apps/desktop/src/main/ipc/handlers/bootstrap.ts` | `apps/desktop/src/main/ipc/handlers/bootstrap.ts` | 223 | `getBootstrapStatus` |
| `BOOTSTRAP_REBOOTSTRAP` | `bindNoArg → apps/desktop/src/main/ipc/handlers/bootstrap.ts` | `apps/desktop/src/main/ipc/handlers/bootstrap.ts` | 224 | `rebootstrap` |
| `AGENT_ACTIVITY_GET` | `bindNoArg → (inline)` | — | 315 | `ipcAgentActivityGet` |
| `SCOPE_GET` | `bindNoArg → apps/desktop/src/main/ipc/handlers/scope.ts` | `apps/desktop/src/main/ipc/handlers/scope.ts` | 225 | `ipcScopeGet` |
| `SCOPE_SET_PROJECT` | `bindReq → apps/desktop/src/main/ipc/handlers/scope.ts` | `apps/desktop/src/main/ipc/handlers/scope.ts` | 227 | `ipcScopeSetProject` |
| `SCOPE_SET_SESSION` | `bindReq → apps/desktop/src/main/ipc/handlers/scope.ts` | `apps/desktop/src/main/ipc/handlers/scope.ts` | 228 | `ipcScopeSetSession` |
| `PROJECTS_LIST` | `bindNoArg → apps/desktop/src/main/ipc/handlers/projects.ts` | `apps/desktop/src/main/ipc/handlers/projects.ts` | 229 | `ipcProjectsList` |
| `PROJECTS_CREATE` | `bindReq → apps/desktop/src/main/ipc/handlers/projects.ts` | `apps/desktop/src/main/ipc/handlers/projects.ts` | 231 | `ipcProjectsCreate` |
| `PROJECTS_RENAME` | `bindReq → apps/desktop/src/main/ipc/handlers/projects.ts` | `apps/desktop/src/main/ipc/handlers/projects.ts` | 232 | `ipcProjectsRename` |
| `PROJECTS_DELETE` | `bindReq → apps/desktop/src/main/ipc/handlers/projects.ts` | `apps/desktop/src/main/ipc/handlers/projects.ts` | 233 | `ipcProjectsDelete` |
| `PROJECTS_GET_AGENT_CONFIG` | `bindReq → apps/desktop/src/main/ipc/handlers/projects.ts` | `apps/desktop/src/main/ipc/handlers/projects.ts` | 234 | `ipcProjectsGetAgentConfig` |
| `PROJECTS_UPDATE_AGENT_CONFIG` | `bindReq → apps/desktop/src/main/ipc/handlers/projects.ts` | `apps/desktop/src/main/ipc/handlers/projects.ts` | 235 | `ipcProjectsUpdateAgentConfig` |
| `SESSIONS_LIST_BY_PROJECT` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 239 | `ipcSessionsListByProject` |
| `SESSIONS_CREATE` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 241 | `ipcSessionsCreate` |
| `SESSIONS_RENAME` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 242 | `ipcSessionsRename` |
| `SESSIONS_DELETE` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 243 | `ipcSessionsDelete` |
| `SESSIONS_GET_COMPOSER_DRAFT` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 246 | `ipcSessionsGetComposerDraft` |
| `SESSIONS_SET_COMPOSER_DRAFT` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 247 | `ipcSessionsSetComposerDraft` |
| `SESSIONS_PROJECT_COMPOSER_STATUS` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 248 | `ipcSessionsProjectComposerStatus` |
| `SESSIONS_GET_AGENT_BINDING` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 252 | `ipcSessionsGetAgentBinding` |
| `SESSIONS_SET_AGENT_BINDING` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 253 | `ipcSessionsSetAgentBinding` |
| `SESSIONS_SET_MODEL_OVERRIDE` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 254 | `ipcSessionsSetModelOverride` |
| `APP_UI_GET` | `bindReq → apps/desktop/src/main/ipc/handlers/app-ui.ts` | `apps/desktop/src/main/ipc/handlers/app-ui.ts` | 258 | `ipcSessionsSetModelOverride` |
| `APP_UI_SET` | `bindReq → apps/desktop/src/main/ipc/handlers/app-ui.ts` | `apps/desktop/src/main/ipc/handlers/app-ui.ts` | 260 | `ipcSessionsSetModelOverride` |
| `VFS_LIST` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 261 | — |
| `VFS_READ` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 263 | `ipcVfsRead` |
| `PHYSICAL_LIST` | `bindReq → apps/desktop/src/main/ipc/handlers/physical.ts` | `apps/desktop/src/main/ipc/handlers/physical.ts` | 265 | `ipcPhysicalList` |
| `PHYSICAL_READ` | `bindReq → apps/desktop/src/main/ipc/handlers/physical.ts` | `apps/desktop/src/main/ipc/handlers/physical.ts` | 266 | `ipcPhysicalRead` |
| `VFS_WRITE` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 267 | `ipcVfsWrite` |
| `VFS_MKDIR` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 268 | `ipcVfsMkdir` |
| `VFS_DELETE` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 269 | `ipcVfsDelete` |
| `VFS_RENAME` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 270 | `ipcVfsRename` |
| `VFS_ZIP_EXPORT` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 271 | `ipcVfsZipExport` |
| `VFS_ZIP_IMPORT` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 272 | `ipcVfsZipImport` |
| `VFS_ZIP_PICK` | `bindNoArg → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 273 | `ipcVfsZipPick` |
| `VFS_ZIP_IMPORT_BYTES` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 274 | `ipcVfsZipImportBytes` |
| `VFS_CHARACTER_CARD_IMPORT` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 275 | `ipcVfsCharacterCardImport` |
| `VFS_BATCH_INGEST_FROM_PATHS` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 276 | `ipcVfsBatchIngestFromPaths` |
| `VFS_BATCH_EXPORT_STAGE` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 277 | `ipcVfsBatchExportStage` |
| `VFS_BATCH_CLEAR_STAGING` | `bindReq → apps/desktop/src/main/ipc/handlers/vfs.ts` | `apps/desktop/src/main/ipc/handlers/vfs.ts` | 278 | `ipcVfsBatchClearStaging` |
| `VFS_START_DRAG` | `ipcMain.on → (inline)` | — | 280 | — |
| `WORKPLACE_BUILD_LIST_ROWS` | `bindReq → apps/desktop/src/main/ipc/handlers/workplace.ts` | `apps/desktop/src/main/ipc/handlers/workplace.ts` | 286 | `ipcWorkplaceBuildListRows` |
| `WORKPLACE_SET_DIR_RULE` | `bindReq → apps/desktop/src/main/ipc/handlers/workplace.ts` | `apps/desktop/src/main/ipc/handlers/workplace.ts` | 288 | `ipcWorkplaceSetDirRule` |
| `WORKPLACE_SET_FILE_RULE` | `bindReq → apps/desktop/src/main/ipc/handlers/workplace.ts` | `apps/desktop/src/main/ipc/handlers/workplace.ts` | 289 | `ipcWorkplaceSetFileRule` |
| `WORKPLACE_GET_DIR_RULE` | `bindReq → apps/desktop/src/main/ipc/handlers/workplace.ts` | `apps/desktop/src/main/ipc/handlers/workplace.ts` | 290 | `ipcWorkplaceGetDirRule` |
| `WORKPLACE_CAPTURE_SESSION_BLOCK` | `bindReq → apps/desktop/src/main/ipc/handlers/workplace.ts` | `apps/desktop/src/main/ipc/handlers/workplace.ts` | 291 | `ipcWorkplaceCaptureSessionBlock` |
| `SESSIONS_PULL_TEMPLATE` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 244 | `ipcSessionsPullTemplate` |
| `SESSIONS_PUSH_TEMPLATE` | `bindReq → apps/desktop/src/main/ipc/handlers/sessions.ts` | `apps/desktop/src/main/ipc/handlers/sessions.ts` | 245 | `ipcSessionsPushTemplate` |
| `MESSAGES_LIST` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 295 | `ipcMessagesList` |
| `MESSAGES_APPEND` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 298 | `ipcMessagesAppend` |
| `MESSAGES_EDIT` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 299 | `ipcMessagesEdit` |
| `MESSAGES_HIDE` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 300 | `ipcMessagesHide` |
| `MESSAGES_SHOW` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 301 | `ipcMessagesShow` |
| `MESSAGES_HIDE_RANGE` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 302 | `ipcMessagesHideRange` |
| `MESSAGES_SHOW_RANGE` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 303 | `ipcMessagesShowRange` |
| `MESSAGES_TRUNCATE_AFTER` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 304 | `ipcMessagesTruncateAfter` |
| `MESSAGES_DELETE` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 305 | `ipcMessagesDelete` |
| `MESSAGES_FORK` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 306 | `ipcMessagesFork` |
| `MESSAGES_ROLLBACK` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 307 | `ipcMessagesRollback` |
| `MESSAGES_SET_FLOOR` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 308 | `ipcMessagesSetFloor` |
| `MESSAGES_SEARCH` | `bindReq → apps/desktop/src/main/ipc/handlers/messages.ts` | `apps/desktop/src/main/ipc/handlers/messages.ts` | 297 | `ipcMessagesSearch` |
| `AGENT_RUN` | `bindReq → apps/desktop/src/main/ipc/handlers/agent.ts` | `apps/desktop/src/main/ipc/handlers/agent.ts` | 311 | `ipcAgentRun` |
| `AGENT_ABORT` | `bindReq → apps/desktop/src/main/ipc/handlers/agent.ts` | `apps/desktop/src/main/ipc/handlers/agent.ts` | 313 | `ipcAgentAbort` |
| `AGENT_RUN_IS_ACTIVE` | `bindReq → apps/desktop/src/main/ipc/handlers/agent.ts` | `apps/desktop/src/main/ipc/handlers/agent.ts` | 314 | `ipcAgentRunIsActive` |
| `AGENT_RESOLVE_CURRENT` | `bindNoArg → apps/desktop/src/main/ipc/handlers/agent.ts` | `apps/desktop/src/main/ipc/handlers/agent.ts` | 318 | `ipcAgentResolveCurrent` |
| `AGENT_LIST_PICKER` | `bindNoArg → apps/desktop/src/main/ipc/handlers/agent.ts` | `apps/desktop/src/main/ipc/handlers/agent.ts` | 319 | `ipcAgentListPicker` |
| `AGENT_SET_CURRENT` | `bindReq → apps/desktop/src/main/ipc/handlers/agent.ts` | `apps/desktop/src/main/ipc/handlers/agent.ts` | 320 | `ipcAgentSetCurrent` |
| `MODEL_LIST_PICKER` | `bindNoArg → apps/desktop/src/main/ipc/handlers/agent.ts` | `apps/desktop/src/main/ipc/handlers/agent.ts` | 321 | `ipcModelListPicker` |
| `MODEL_SET_CURRENT` | `bindReq → apps/desktop/src/main/ipc/handlers/agent.ts` | `apps/desktop/src/main/ipc/handlers/agent.ts` | 322 | `ipcModelSetCurrent` |
| `PROMPT_REAL_PREVIEW` | `bindReq → apps/desktop/src/main/ipc/handlers/prompt.ts` | `apps/desktop/src/main/ipc/handlers/prompt.ts` | 323 | `ipcPromptRealPreview` |
| `PROMPT_CHAT_TOKEN_LABEL` | `bindReq → apps/desktop/src/main/ipc/handlers/prompt.ts` | `apps/desktop/src/main/ipc/handlers/prompt.ts` | 325 | `ipcPromptChatTokenLabel` |
| `PROMPT_AGENT_META` | `bindReq → apps/desktop/src/main/ipc/handlers/prompt.ts` | `apps/desktop/src/main/ipc/handlers/prompt.ts` | 326 | `ipcPromptAgentMeta` |
| `COMPACTION_MANUAL` | `bindReq → apps/desktop/src/main/ipc/handlers/compaction.ts` | `apps/desktop/src/main/ipc/handlers/compaction.ts` | 327 | `ipcCompactionManual` |
| `PREFERENCES_GET_LLM_STREAM` | `bindNoArg → apps/desktop/src/main/ipc/handlers/preferences.ts` | `apps/desktop/src/main/ipc/handlers/preferences.ts` | 329 | `ipcPreferencesGetLlmStream` |
| `PREFERENCES_SET_LLM_STREAM` | `bindBool → apps/desktop/src/main/ipc/handlers/preferences.ts` | `apps/desktop/src/main/ipc/handlers/preferences.ts` | 334 | `ipcPreferencesSetLlmStream` |
| `PREFERENCES_GET_SUBAGENT_STREAM` | `bindNoArg → apps/desktop/src/main/ipc/handlers/preferences.ts` | `apps/desktop/src/main/ipc/handlers/preferences.ts` | 338 | `ipcPreferencesGetSubagentStream` |
| `PREFERENCES_SET_SUBAGENT_STREAM` | `bindBool → apps/desktop/src/main/ipc/handlers/preferences.ts` | `apps/desktop/src/main/ipc/handlers/preferences.ts` | 342 | `ipcPreferencesSetSubagentStream` |
| `PREFERENCES_GET_THINKING_CONTEXT` | `bindNoArg → apps/desktop/src/main/ipc/handlers/preferences.ts` | `apps/desktop/src/main/ipc/handlers/preferences.ts` | 346 | `ipcPreferencesGetThinkingContext` |
| `PREFERENCES_SET_THINKING_CONTEXT` | `bindBool → apps/desktop/src/main/ipc/handlers/preferences.ts` | `apps/desktop/src/main/ipc/handlers/preferences.ts` | 350 | `ipcPreferencesSetThinkingContext` |
| `PROVIDERS_LIST` | `bindNoArg → apps/desktop/src/main/ipc/handlers/providers.ts` | `apps/desktop/src/main/ipc/handlers/providers.ts` | 354 | `ipcProvidersList` |
| `PROVIDERS_GET` | `bindReq → apps/desktop/src/main/ipc/handlers/providers.ts` | `apps/desktop/src/main/ipc/handlers/providers.ts` | 356 | `ipcProvidersGet` |
| `PROVIDERS_CREATE` | `bindReq → apps/desktop/src/main/ipc/handlers/providers.ts` | `apps/desktop/src/main/ipc/handlers/providers.ts` | 357 | `ipcProvidersCreate` |
| `PROVIDERS_EDIT` | `bindReq → apps/desktop/src/main/ipc/handlers/providers.ts` | `apps/desktop/src/main/ipc/handlers/providers.ts` | 358 | `ipcProvidersEdit` |
| `PROVIDERS_DELETE` | `bindReq → apps/desktop/src/main/ipc/handlers/providers.ts` | `apps/desktop/src/main/ipc/handlers/providers.ts` | 359 | `ipcProvidersDelete` |
| `PROVIDER_MODELS_SAVED_LIST` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 360 | `ipcProviderModelsSavedList` |
| `PROVIDER_MODELS_FETCH` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 365 | `ipcProviderModelsFetch` |
| `PROVIDER_MODELS_SUGGEST_LIST` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 366 | `ipcProviderModelsSuggestList` |
| `PROVIDER_MODELS_SAVE` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 370 | `ipcProviderModelsSavedList` |
| `PROVIDER_MODELS_DELETE_SAVED` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 371 | `ipcProviderModelsDeleteSaved` |
| `PROVIDER_MODELS_GET_SAVED` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 375 | `ipcProviderModelsGetSaved` |
| `PROVIDER_MODELS_UPDATE_SETTINGS` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 376 | `ipcProviderModelsUpdateSettings` |
| `PROVIDER_MODELS_RESET_CONTEXT_WINDOW` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 380 | `ipcProviderModelsResetContextWindow` |
| `PROVIDER_MODELS_EDIT_SAVED` | `bindReq → apps/desktop/src/main/ipc/handlers/provider-models.ts` | `apps/desktop/src/main/ipc/handlers/provider-models.ts` | 384 | `ipcProviderModelsEditSaved` |
| `AGENT_REGISTRY_LIST` | `bindNoArg → apps/desktop/src/main/ipc/handlers/agent-registry.ts` | `apps/desktop/src/main/ipc/handlers/agent-registry.ts` | 388 | `ipcAgentRegistryList` |
| `AGENT_REGISTRY_GET` | `bindReq → apps/desktop/src/main/ipc/handlers/agent-registry.ts` | `apps/desktop/src/main/ipc/handlers/agent-registry.ts` | 390 | `ipcAgentRegistryGet` |
| `AGENT_REGISTRY_UPSERT` | `bindReq → apps/desktop/src/main/ipc/handlers/agent-registry.ts` | `apps/desktop/src/main/ipc/handlers/agent-registry.ts` | 391 | `ipcAgentRegistryUpsert` |
| `AGENT_REGISTRY_DELETE` | `bindReq → apps/desktop/src/main/ipc/handlers/agent-registry.ts` | `apps/desktop/src/main/ipc/handlers/agent-registry.ts` | 392 | `ipcAgentRegistryDelete` |
| `AGENT_REGISTRY_CREATE_BLANK` | `bindReq → apps/desktop/src/main/ipc/handlers/agent-registry.ts` | `apps/desktop/src/main/ipc/handlers/agent-registry.ts` | 394 | `ipcAgentRegistryCreateBlank` |
| `AGENT_YAML_EXPORT` | `bindReq → apps/desktop/src/main/ipc/handlers/agent-registry.ts` | `apps/desktop/src/main/ipc/handlers/agent-registry.ts` | 398 | `ipcAgentYamlExport` |
| `AGENT_YAML_IMPORT` | `bindReq → apps/desktop/src/main/ipc/handlers/agent-registry.ts` | `apps/desktop/src/main/ipc/handlers/agent-registry.ts` | 399 | `ipcAgentYamlImport` |
| `SMART_SORT_RULE_LIST` | `bindNoArg → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 400 | `ipcSmartSortRuleList` |
| `SMART_SORT_RULE_CREATE` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 403 | `ipcSmartSortRuleCreate` |
| `SMART_SORT_RULE_UPDATE` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 404 | `ipcSmartSortRuleUpdate` |
| `SMART_SORT_RULE_DELETE` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 405 | `ipcSmartSortRuleDelete` |
| `SMART_SORT_RULE_DELETE_BATCH` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 406 | `ipcSmartSortRuleDeleteBatch` |
| `SMART_SORT_RULE_SET_ENABLED` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 407 | `ipcSmartSortRuleSetEnabled` |
| `SMART_SORT_RULE_SET_ENABLED_BATCH` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 408 | `ipcSmartSortRuleSetEnabledBatch` |
| `SMART_SORT_RULE_MOVE` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 412 | `ipcSmartSortRuleMove` |
| `SMART_SORT_RULE_REORDER` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 413 | `ipcSmartSortRuleReorder` |
| `SMART_SORT_RULE_IMPORT_RULES` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 415 | `ipcSmartSortRuleImportRules` |
| `SMART_SORT_RULE_EXPORT_RULES` | `bindNoArg → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 414 | `ipcSmartSortRuleExportRules` |
| `SMART_SORT_RULE_RESET_DEFAULTS` | `bindNoArg → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 416 | `ipcSmartSortRuleResetDefaults` |
| `SMART_SORT_RULE_MATCH` | `bindReq → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 420 | `ipcSmartSortRuleMatch` |
| `SMART_SORT_RULE_YAML_EXPORT` | `bindNoArg → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 421 | `ipcSmartSortRuleYamlExport` |
| `SMART_SORT_RULE_YAML_IMPORT` | `bindNoArg → apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | `apps/desktop/src/main/ipc/handlers/smart-sort-rule.ts` | 422 | `ipcSmartSortRuleYamlImport` |
| `SKILLS_LIST` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 423 | `ipcSkillsList` |
| `SKILLS_EFFECTIVE` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 425 | `ipcSkillsEffective` |
| `SKILLS_READ` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 426 | `ipcSkillsRead` |
| `SKILLS_WRITE` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 427 | `ipcSkillsWrite` |
| `SKILLS_EDIT` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 428 | `ipcSkillsEdit` |
| `SKILLS_TOGGLE` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 429 | `ipcSkillsToggle` |
| `SKILLS_DELETE` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 430 | `ipcSkillsDelete` |
| `SKILLS_ASSERT_CREATE_NAME` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 431 | `ipcSkillsAssertCreateName` |
| `SKILLS_UPDATE_INFO` | `bindReq → apps/desktop/src/main/ipc/handlers/skills.ts` | `apps/desktop/src/main/ipc/handlers/skills.ts` | 432 | `ipcSkillsUpdateInfo` |
| `COMPACTION_CONDITIONS_GET` | `bindNoArg → apps/desktop/src/main/ipc/handlers/compaction-conditions.ts` | `apps/desktop/src/main/ipc/handlers/compaction-conditions.ts` | 433 | `ipcCompactionConditionsGet` |
| `COMPACTION_CONDITIONS_SET` | `bindReq → apps/desktop/src/main/ipc/handlers/compaction-conditions.ts` | `apps/desktop/src/main/ipc/handlers/compaction-conditions.ts` | 438 | `ipcCompactionConditionsSet` |
| `BACKUP_EXPORT` | `bindNoArg → apps/desktop/src/main/ipc/handlers/backup.ts` | `apps/desktop/src/main/ipc/handlers/backup.ts` | 442 | `ipcBackupExport` |
| `BACKUP_IMPORT` | `bindNoArg → apps/desktop/src/main/ipc/handlers/backup.ts` | `apps/desktop/src/main/ipc/handlers/backup.ts` | 444 | `ipcBackupImport` |
| `DB_STATS` | `bindNoArg → apps/desktop/src/main/ipc/handlers/db-maintenance.ts` | `apps/desktop/src/main/ipc/handlers/db-maintenance.ts` | 445 | `ipcDbStats` |
| `DB_MAINTENANCE` | `bindNoArg → apps/desktop/src/main/ipc/handlers/db-maintenance.ts` | `apps/desktop/src/main/ipc/handlers/db-maintenance.ts` | 447 | `ipcDbMaintenance` |
| `CLOUD_SYNC_GET_CONFIG` | `bindNoArg → apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | 448 | `ipcCloudSyncGetConfig` |
| `CLOUD_SYNC_SET_CONFIG` | `bindReq → apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | 450 | `ipcCloudSyncSetConfig` |
| `CLOUD_SYNC_SET_ENABLED` | `bindBool → apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | 451 | `ipcCloudSyncSetEnabled` |
| `CLOUD_SYNC_TEST_CONNECTION` | `bindNoArg → apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | 452 | `ipcCloudSyncTestConnection` |
| `CLOUD_SYNC_GET_LOCAL_STATUS` | `bindNoArg → apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | 456 | `ipcCloudSyncGetLocalStatus` |
| `CLOUD_SYNC_PULL` | `bindNoArg → apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | 460 | `ipcCloudSyncPull` |
| `CLOUD_SYNC_PUSH` | `bindReq → apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | `apps/desktop/src/main/ipc/handlers/cloud-sync.ts` | 461 | `ipcCloudSyncPull` |
| `SEARCH_GET_CONFIG` | `bindNoArg → apps/desktop/src/main/ipc/handlers/search.ts` | `apps/desktop/src/main/ipc/handlers/search.ts` | 462 | `ipcSearchGetConfig` |
| `SEARCH_SAVE_ENGINE_KEY` | `bindReq → apps/desktop/src/main/ipc/handlers/search.ts` | `apps/desktop/src/main/ipc/handlers/search.ts` | 464 | `ipcSearchSaveEngineKey` |
| `SEARCH_CLEAR_ENGINE_KEY` | `bindReq → apps/desktop/src/main/ipc/handlers/search.ts` | `apps/desktop/src/main/ipc/handlers/search.ts` | 465 | `ipcSearchClearEngineKey` |
| `SEARCH_SET_SEARXNG_BASE_URL` | `bindReq → apps/desktop/src/main/ipc/handlers/search.ts` | `apps/desktop/src/main/ipc/handlers/search.ts` | 466 | `ipcSearchSetSearxngBaseUrl` |
| `SEARCH_SET_ENGINE_ORDER` | `bindReq → apps/desktop/src/main/ipc/handlers/search.ts` | `apps/desktop/src/main/ipc/handlers/search.ts` | 470 | `ipcSearchSetEngineOrder` |
| `SHELL_MENU_POPUP` | `bindEventReq → apps/desktop/src/main/ipc/handlers/shell.ts` | `apps/desktop/src/main/ipc/handlers/shell.ts` | 474 | `ipcShellMenuPopup` |
| `SHELL_SET_TITLEBAR_THEME` | `bindEventReq → apps/desktop/src/main/ipc/handlers/shell.ts` | `apps/desktop/src/main/ipc/handlers/shell.ts` | 476 | `ipcShellMenuPopup` |
| `SHELL_OPEN_EXTERNAL` | `bindReq → apps/desktop/src/main/ipc/handlers/app-info.ts` | `apps/desktop/src/main/ipc/handlers/app-info.ts` | 480 | `ipcAppOpenExternal` |
| `USAGE_STATS_QUERY` | `bindReq → apps/desktop/src/main/ipc/handlers/usage-stats.ts` | `apps/desktop/src/main/ipc/handlers/usage-stats.ts` | 309 | `ipcUsageStatsQuery` |
| `APP_GET_INFO` | `bindNoArg → apps/desktop/src/main/ipc/handlers/app-info.ts` | `apps/desktop/src/main/ipc/handlers/app-info.ts` | 481 | `ipcAppGetInfo` |
| `APP_CHECK_FOR_UPDATES` | `bindNoArg → apps/desktop/src/main/ipc/handlers/app-info.ts` | `apps/desktop/src/main/ipc/handlers/app-info.ts` | 483 | `ipcAppCheckForUpdates` |

## 二、push 通道（main → renderer）四段链路

| 通道 | KEY | ① main 生产 | ② 转发器接线 | ③ client.ts 订阅封装 | ④ renderer 消费 | 断链 |
|---|---|---|---|---|---|---|
| `nm:agent-stream` | `AGENT_STREAM` | ✅ `apps/desktop/src/main/ipc/forward-event-bus.ts` | ✅ `attachEventBusForwarder` @ `apps/desktop/src/main/main.ts:14` | ✅ `onAgentStream` | ✅ 5 处 | — |
| `nm:agent/activity` | `AGENT_ACTIVITY` | ✅ `apps/desktop/src/main/ipc/forward-agent-activity.ts` | ✅ `attachAgentActivityForwarder` @ `apps/desktop/src/main/main.ts:18` | ✅ `onAgentActivity` | ✅ 1 处 | — |
| `nm:workspace/mutated` | `WORKSPACE_MUTATED` | ✅ `apps/desktop/src/main/ipc/forward-workspace-mutated.ts` | ✅ `setWorkspaceMutatedForwardTarget` @ `apps/desktop/src/main/main.ts:21` | ✅ `onWorkspaceMutated` | ✅ 2 处 | — |
| `nm:composer/attachmentsSuggest` | `COMPOSER_ATTACHMENTS_SUGGEST` | ✅ `apps/desktop/src/main/ipc/forward-composer-attachments-suggest.ts` | ✅ `setComposerAttachmentsSuggestForwardTarget` @ `apps/desktop/src/main/main.ts:22` | ✅ `onComposerAttachmentsSuggest` | ✅ 2 处 | — |
| `nm:agent/userMessageAppended` | `AGENT_USER_MESSAGE_APPENDED` | ✅ `apps/desktop/src/main/ipc/forward-user-message-appended.ts` | ✅ `setUserMessageAppendedForwardTarget` @ `apps/desktop/src/main/main.ts:24` | ✅ `onUserMessageAppended` | ✅ 2 处 | — |
| `nm:vfs/startDragFailed` | `VFS_START_DRAG_FAILED` | ✅ `apps/desktop/src/main/ipc/handlers/vfs.ts` | — n/a（handler 内直接 send） | ✅ `onVfsStartDragFailed` | ✅ 2 处 | — |
| `nm:prompt/chatTokenUpdated` | `PROMPT_CHAT_TOKEN_UPDATED` | ✅ `apps/desktop/src/main/ipc/forward-prompt-chat-token-updated.ts` | ✅ `setPromptChatTokenUpdatedForwardTarget` @ `apps/desktop/src/main/main.ts:23` | ✅ `onPromptChatTokenUpdated` | ✅ 4 处 | — |

## 三、断链清单（W3 权威）

| 通道 | KEY | 类型 | 断点 |
|---|---|---|---|
| `nm:projects/getAgentConfig` | `PROJECTS_GET_AGENT_CONFIG` | invoke | ⑤ renderer 无消费 |
| `nm:projects/updateAgentConfig` | `PROJECTS_UPDATE_AGENT_CONFIG` | invoke | ⑤ renderer 无消费 |
| `nm:sessions/getAgentBinding` | `SESSIONS_GET_AGENT_BINDING` | invoke | ⑤ renderer 无消费 |
| `nm:vfs/list` | `VFS_LIST` | invoke | ③ invoke-registry 未封装 |
| `nm:vfs/startDrag` | `VFS_START_DRAG` | invoke | ③ invoke-registry 未封装 |
| `nm:workplace/captureSessionBlock` | `WORKPLACE_CAPTURE_SESSION_BLOCK` | invoke | ⑤ renderer 无消费 |
| `nm:messages/hideRange` | `MESSAGES_HIDE_RANGE` | invoke | ⑤ renderer 无消费 |
| `nm:messages/showRange` | `MESSAGES_SHOW_RANGE` | invoke | ⑤ renderer 无消费 |
| `nm:messages/truncateAfter` | `MESSAGES_TRUNCATE_AFTER` | invoke | ⑤ renderer 无消费 |
| `nm:sort-rule/importRules` | `SMART_SORT_RULE_IMPORT_RULES` | invoke | ⑤ renderer 无消费 |
| `nm:sort-rule/exportRules` | `SMART_SORT_RULE_EXPORT_RULES` | invoke | ⑤ renderer 无消费 |
| `nm:skills/edit` | `SKILLS_EDIT` | invoke | ⑤ renderer 无消费 |

## 四、⑤ 层明细（renderer 消费点 file:line）

| KEY | 封装名 | renderer 消费点数 | 消费点（前 8 个） | 仅测试引用 |
|---|---|---|---|---|
| `BOOTSTRAP_STATUS` | `getBootstrapStatus` | 2 | `apps/desktop/renderer/providers/NovelMasterProvider.tsx:16`<br>`apps/desktop/renderer/providers/NovelMasterProvider.tsx:70` | — |
| `BOOTSTRAP_REBOOTSTRAP` | `rebootstrap` | 3 | `apps/desktop/renderer/providers/NovelMasterProvider.tsx:17`<br>`apps/desktop/renderer/providers/NovelMasterProvider.tsx:27`<br>`apps/desktop/renderer/providers/NovelMasterProvider.tsx:69` | `apps/desktop/test/blob-binary-normalization-service.test.ts`<br>`apps/desktop/test/db-backup-busy.test.ts` |
| `AGENT_STREAM` | `onAgentStream` | 5 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:51`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:159`<br>`apps/desktop/renderer/hooks/useAgentStream.ts:153`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:53`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:331` | `apps/desktop/test/shell-nav-child-run-refresh.test.ts` |
| `AGENT_ACTIVITY` | `onAgentActivity` | 1 | `apps/desktop/renderer/hooks/useDesktopAgentActive.ts:14` | — |
| `AGENT_ACTIVITY_GET` | `ipcAgentActivityGet` | 1 | `apps/desktop/renderer/hooks/useDesktopAgentActive.ts:11` | — |
| `WORKSPACE_MUTATED` | `onWorkspaceMutated` | 2 | `apps/desktop/renderer/providers/ShellNavProvider.tsx:55`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:313` | — |
| `COMPOSER_ATTACHMENTS_SUGGEST` | `onComposerAttachmentsSuggest` | 2 | `apps/desktop/renderer/features/chat/ChatComposer.tsx:17`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:125` | — |
| `AGENT_USER_MESSAGE_APPENDED` | `onUserMessageAppended` | 2 | `apps/desktop/renderer/features/chat/ChatComposer.tsx:18`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:154` | — |
| `SCOPE_GET` | `ipcScopeGet` | 2 | `apps/desktop/renderer/state/desktop-scope.ts:7`<br>`apps/desktop/renderer/state/desktop-scope.ts:24` | — |
| `SCOPE_SET_PROJECT` | `ipcScopeSetProject` | 2 | `apps/desktop/renderer/state/desktop-scope.ts:8`<br>`apps/desktop/renderer/state/desktop-scope.ts:31` | — |
| `SCOPE_SET_SESSION` | `ipcScopeSetSession` | 2 | `apps/desktop/renderer/state/desktop-scope.ts:9`<br>`apps/desktop/renderer/state/desktop-scope.ts:39` | — |
| `PROJECTS_LIST` | `ipcProjectsList` | 9 | `apps/desktop/renderer/features/chat/SessionSkillPanel.tsx:12`<br>`apps/desktop/renderer/features/chat/SessionSkillPanel.tsx:53`<br>`apps/desktop/renderer/features/settings/SkillDetailView.tsx:112`<br>`apps/desktop/renderer/features/settings/SkillsManageView.tsx:17`<br>`apps/desktop/renderer/features/settings/SkillsManageView.tsx:79`<br>`apps/desktop/renderer/layout/ChatRail.tsx:15`<br>`apps/desktop/renderer/layout/ChatRail.tsx:117`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:47` | — |
| `PROJECTS_CREATE` | `ipcProjectsCreate` | 2 | `apps/desktop/renderer/layout/ChatRail.tsx:13`<br>`apps/desktop/renderer/layout/ChatRail.tsx:286` | — |
| `PROJECTS_RENAME` | `ipcProjectsRename` | 2 | `apps/desktop/renderer/layout/ChatRail.tsx:16`<br>`apps/desktop/renderer/layout/ChatRail.tsx:294` | — |
| `PROJECTS_DELETE` | `ipcProjectsDelete` | 3 | `apps/desktop/renderer/layout/ChatRail.tsx:14`<br>`apps/desktop/renderer/layout/ChatRail.tsx:163`<br>`apps/desktop/renderer/layout/ChatRail.tsx:250` | — |
| `PROJECTS_GET_AGENT_CONFIG` | `ipcProjectsGetAgentConfig` | 0 | — | — |
| `PROJECTS_UPDATE_AGENT_CONFIG` | `ipcProjectsUpdateAgentConfig` | 0 | — | — |
| `SESSIONS_LIST_BY_PROJECT` | `ipcSessionsListByProject` | 4 | `apps/desktop/renderer/layout/ChatRail.tsx:19`<br>`apps/desktop/renderer/layout/ChatRail.tsx:129`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:49`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:748` | — |
| `SESSIONS_CREATE` | `ipcSessionsCreate` | 2 | `apps/desktop/renderer/layout/ChatRail.tsx:17`<br>`apps/desktop/renderer/layout/ChatRail.tsx:226` | — |
| `SESSIONS_RENAME` | `ipcSessionsRename` | 4 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:48`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:314`<br>`apps/desktop/renderer/layout/ChatRail.tsx:20`<br>`apps/desktop/renderer/layout/ChatRail.tsx:304` | `apps/desktop/test/session-detail-drawer.test.ts` |
| `SESSIONS_DELETE` | `ipcSessionsDelete` | 3 | `apps/desktop/renderer/layout/ChatRail.tsx:18`<br>`apps/desktop/renderer/layout/ChatRail.tsx:182`<br>`apps/desktop/renderer/layout/ChatRail.tsx:259` | — |
| `SESSIONS_GET_COMPOSER_DRAFT` | `ipcSessionsGetComposerDraft` | 2 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:36`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:322` | — |
| `SESSIONS_SET_COMPOSER_DRAFT` | `ipcSessionsSetComposerDraft` | 2 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:38`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:359` | — |
| `SESSIONS_PROJECT_COMPOSER_STATUS` | `ipcSessionsProjectComposerStatus` | 4 | `apps/desktop/renderer/features/chat/ChatComposer.tsx:14`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:401`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:37`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:323` | — |
| `SESSIONS_GET_AGENT_BINDING` | `ipcSessionsGetAgentBinding` | 0 | — | — |
| `SESSIONS_SET_AGENT_BINDING` | `ipcSessionsSetAgentBinding` | 2 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:49`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:625` | `apps/desktop/test/session-detail-drawer.test.ts` |
| `SESSIONS_SET_MODEL_OVERRIDE` | `ipcSessionsSetModelOverride` | 2 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:50`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:640` | `apps/desktop/test/session-detail-drawer.test.ts` |
| `APP_UI_GET` | `ipcSessionsSetModelOverride` | 2 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:50`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:640` | `apps/desktop/test/session-detail-drawer.test.ts` |
| `APP_UI_SET` | `ipcSessionsSetModelOverride` | 2 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:50`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:640` | `apps/desktop/test/session-detail-drawer.test.ts` |
| `VFS_READ` | `ipcVfsRead` | 5 | `apps/desktop/renderer/features/chat/chat-link-route.ts:26`<br>`apps/desktop/renderer/layout/PreviewPane.tsx:20`<br>`apps/desktop/renderer/layout/PreviewPane.tsx:152`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:51`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:399` | `apps/desktop/test/chat-link-route.test.ts` |
| `PHYSICAL_LIST` | `ipcPhysicalList` | 2 | `apps/desktop/renderer/features/workspace/WorkspaceTree.tsx:8`<br>`apps/desktop/renderer/features/workspace/WorkspaceTree.tsx:94` | — |
| `PHYSICAL_READ` | `ipcPhysicalRead` | 2 | `apps/desktop/renderer/layout/PreviewPane.tsx:19`<br>`apps/desktop/renderer/layout/PreviewPane.tsx:151` | — |
| `VFS_WRITE` | `ipcVfsWrite` | 4 | `apps/desktop/renderer/features/workspace/workspace-actions.ts:14`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:79`<br>`apps/desktop/renderer/layout/PreviewPane.tsx:21`<br>`apps/desktop/renderer/layout/PreviewPane.tsx:333` | — |
| `VFS_MKDIR` | `ipcVfsMkdir` | 2 | `apps/desktop/renderer/features/workspace/workspace-actions.ts:12`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:84` | — |
| `VFS_DELETE` | `ipcVfsDelete` | 3 | `apps/desktop/renderer/features/settings/SkillDetailView.tsx:227`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:11`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:130` | — |
| `VFS_RENAME` | `ipcVfsRename` | 4 | `apps/desktop/renderer/features/workspace/workspace-actions.ts:13`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:115`<br>`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:17`<br>`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:324` | — |
| `VFS_ZIP_EXPORT` | `ipcVfsZipExport` | 4 | `apps/desktop/renderer/App.tsx:32`<br>`apps/desktop/renderer/App.tsx:189`<br>`apps/desktop/renderer/features/settings/SkillsManageView.tsx:20`<br>`apps/desktop/renderer/features/settings/SkillsManageView.tsx:174` | `apps/desktop/test/skills-manage-export-menu.test.ts` |
| `VFS_ZIP_IMPORT` | `ipcVfsZipImport` | 2 | `apps/desktop/renderer/App.tsx:33`<br>`apps/desktop/renderer/App.tsx:307` | — |
| `VFS_ZIP_PICK` | `ipcVfsZipPick` | 2 | `apps/desktop/renderer/features/skills/NewSkillModal.tsx:22`<br>`apps/desktop/renderer/features/skills/NewSkillModal.tsx:93` | — |
| `VFS_ZIP_IMPORT_BYTES` | `ipcVfsZipImportBytes` | 2 | `apps/desktop/renderer/features/skills/NewSkillModal.tsx:21`<br>`apps/desktop/renderer/features/skills/NewSkillModal.tsx:162` | `apps/desktop/test/skill-zip-import.test.tsx` |
| `VFS_CHARACTER_CARD_IMPORT` | `ipcVfsCharacterCardImport` | 2 | `apps/desktop/renderer/App.tsx:31`<br>`apps/desktop/renderer/App.tsx:322` | — |
| `VFS_BATCH_INGEST_FROM_PATHS` | `ipcVfsBatchIngestFromPaths` | 3 | `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:16`<br>`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:255`<br>`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:287` | — |
| `VFS_BATCH_EXPORT_STAGE` | `ipcVfsBatchExportStage` | 2 | `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:15`<br>`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:174` | — |
| `VFS_BATCH_CLEAR_STAGING` | `ipcVfsBatchClearStaging` | 2 | `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:14`<br>`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:49` | — |
| `VFS_START_DRAG_FAILED` | `onVfsStartDragFailed` | 2 | `apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:18`<br>`apps/desktop/renderer/features/workspace/workspace-batch-dnd.ts:92` | — |
| `WORKPLACE_BUILD_LIST_ROWS` | `ipcWorkplaceBuildListRows` | 5 | `apps/desktop/renderer/features/chat/ChatComposer.tsx:16`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:189`<br>`apps/desktop/renderer/features/chat/FileReferencePicker.tsx:65`<br>`apps/desktop/renderer/features/workspace/WorkspaceTree.tsx:9`<br>`apps/desktop/renderer/features/workspace/WorkspaceTree.tsx:95` | — |
| `WORKPLACE_SET_DIR_RULE` | `ipcWorkplaceSetDirRule` | 4 | `apps/desktop/renderer/features/workspace/workspace-actions.ts:16`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:89`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:207`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:221` | — |
| `WORKPLACE_SET_FILE_RULE` | `ipcWorkplaceSetFileRule` | 2 | `apps/desktop/renderer/features/workspace/workspace-actions.ts:17`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:55` | — |
| `WORKPLACE_GET_DIR_RULE` | `ipcWorkplaceGetDirRule` | 2 | `apps/desktop/renderer/features/workspace/workspace-actions.ts:15`<br>`apps/desktop/renderer/features/workspace/workspace-actions.ts:185` | — |
| `WORKPLACE_CAPTURE_SESSION_BLOCK` | `ipcWorkplaceCaptureSessionBlock` | 0 | — | — |
| `SESSIONS_PULL_TEMPLATE` | `ipcSessionsPullTemplate` | 1 | `apps/desktop/renderer/features/workspace/WorkspaceHeaderActions.tsx:41` | — |
| `SESSIONS_PUSH_TEMPLATE` | `ipcSessionsPushTemplate` | 1 | `apps/desktop/renderer/features/workspace/WorkspaceHeaderActions.tsx:59` | — |
| `MESSAGES_LIST` | `ipcMessagesList` | 2 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:32`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:270` | — |
| `MESSAGES_APPEND` | `ipcMessagesAppend` | 1 | `apps/desktop/renderer/features/chat/conversation-abort-retain.ts:69` | — |
| `MESSAGES_EDIT` | `ipcMessagesEdit` | 2 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:30`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:838` | — |
| `MESSAGES_HIDE` | `ipcMessagesHide` | 4 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts:7`<br>`apps/desktop/renderer/features/chat/tool-turn-actions.ts:20`<br>`apps/desktop/renderer/features/chat/tool-turn-actions.ts:28`<br>`apps/desktop/renderer/features/chat/tool-turn-actions.ts:31` | — |
| `MESSAGES_SHOW` | `ipcMessagesShow` | 4 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts:8`<br>`apps/desktop/renderer/features/chat/tool-turn-actions.ts:22`<br>`apps/desktop/renderer/features/chat/tool-turn-actions.ts:34`<br>`apps/desktop/renderer/features/chat/tool-turn-actions.ts:37` | — |
| `MESSAGES_HIDE_RANGE` | `ipcMessagesHideRange` | 0 | — | — |
| `MESSAGES_SHOW_RANGE` | `ipcMessagesShowRange` | 0 | — | — |
| `MESSAGES_TRUNCATE_AFTER` | `ipcMessagesTruncateAfter` | 0 | — | — |
| `MESSAGES_DELETE` | `ipcMessagesDelete` | 3 | `apps/desktop/renderer/features/chat/tool-turn-actions.ts:6`<br>`apps/desktop/renderer/features/chat/tool-turn-actions.ts:50`<br>`apps/desktop/renderer/features/chat/tool-turn-actions.ts:53` | — |
| `MESSAGES_FORK` | `ipcMessagesFork` | 2 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:31`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:809` | — |
| `MESSAGES_ROLLBACK` | `ipcMessagesRollback` | 2 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:33`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:707` | — |
| `MESSAGES_SET_FLOOR` | `ipcMessagesSetFloor` | 2 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:34`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:873` | — |
| `MESSAGES_SEARCH` | `ipcMessagesSearch` | 1 | `apps/desktop/renderer/features/chat/ChatHistorySearchPanel.tsx:93` | `apps/desktop/test/chat-search-collapsible-form.test.tsx`<br>`apps/desktop/test/chat-search-race-guard.test.tsx`<br>`apps/desktop/test/session-detail-drawer.test.ts` |
| `AGENT_RUN` | `ipcAgentRun` | 2 | `apps/desktop/renderer/features/chat/ChatComposer.tsx:11`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:379` | `apps/desktop/test/composer-body-clear.test.ts` |
| `AGENT_ABORT` | `ipcAgentAbort` | 4 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:27`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:155`<br>`apps/desktop/renderer/layout/ChatRail.tsx:12`<br>`apps/desktop/renderer/layout/ChatRail.tsx:84` | — |
| `AGENT_RUN_IS_ACTIVE` | `ipcAgentRunIsActive` | 5 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:28`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:541`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:549`<br>`apps/desktop/renderer/features/chat/readOnlyRunProbeLogic.ts:11`<br>`apps/desktop/renderer/features/chat/useReadOnlyRunProbe.ts:54` | `apps/desktop/test/readonly-panel-stale-guard.test.ts` |
| `AGENT_RESOLVE_CURRENT` | `ipcAgentResolveCurrent` | 4 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:27`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:794`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:4`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:64` | — |
| `AGENT_LIST_PICKER` | `ipcAgentListPicker` | 5 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:44`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:274`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:3`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:130`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:321` | — |
| `AGENT_SET_CURRENT` | `ipcAgentSetCurrent` | 4 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:28`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:812`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:5`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:306` | `apps/desktop/test/session-detail-drawer.test.ts` |
| `MODEL_LIST_PICKER` | `ipcModelListPicker` | 6 | `apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:45`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:288`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:10`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:65`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:124`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:317` | — |
| `MODEL_SET_CURRENT` | `ipcModelSetCurrent` | 2 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:11`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:292` | `apps/desktop/test/session-detail-drawer.test.ts` |
| `PROMPT_REAL_PREVIEW` | `ipcPromptRealPreview` | 1 | `apps/desktop/renderer/features/chat/RealPromptPanel.tsx:57` | — |
| `PROMPT_CHAT_TOKEN_LABEL` | `ipcPromptChatTokenLabel` | 4 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:35`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:228`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:47`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:126` | `apps/desktop/test/chat-prompt-tokens-run-suppression.test.ts` |
| `PROMPT_CHAT_TOKEN_UPDATED` | `onPromptChatTokenUpdated` | 4 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:39`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:261`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:52`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:202` | — |
| `PROMPT_AGENT_META` | `ipcPromptAgentMeta` | 5 | `apps/desktop/renderer/features/chat/ChatComposer.tsx:13`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:109`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:348`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:46`<br>`apps/desktop/renderer/features/chat/SessionDetailDrawer.tsx:125` | — |
| `COMPACTION_MANUAL` | `ipcCompactionManual` | 2 | `apps/desktop/renderer/features/chat/ConversationPanel.tsx:29`<br>`apps/desktop/renderer/features/chat/ConversationPanel.tsx:1110` | — |
| `PREFERENCES_GET_LLM_STREAM` | `ipcPreferencesGetLlmStream` | 4 | `apps/desktop/renderer/features/chat/ChatComposer.tsx:12`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:377`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:12`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:66` | — |
| `PREFERENCES_SET_LLM_STREAM` | `ipcPreferencesSetLlmStream` | 2 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:15`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:213` | — |
| `PREFERENCES_GET_SUBAGENT_STREAM` | `ipcPreferencesGetSubagentStream` | 2 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:13`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:70` | `apps/desktop/test/workspace-settings-subagent-stream.test.ts` |
| `PREFERENCES_SET_SUBAGENT_STREAM` | `ipcPreferencesSetSubagentStream` | 2 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:16`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:222` | `apps/desktop/test/workspace-settings-subagent-stream.test.ts` |
| `PREFERENCES_GET_THINKING_CONTEXT` | `ipcPreferencesGetThinkingContext` | 2 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:14`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:69` | — |
| `PREFERENCES_SET_THINKING_CONTEXT` | `ipcPreferencesSetThinkingContext` | 2 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:17`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:231` | — |
| `PROVIDERS_LIST` | `ipcProvidersList` | 7 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:50`<br>`apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:298`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:61`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:324`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:50`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1035`<br>`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:558` | — |
| `PROVIDERS_GET` | `ipcProvidersGet` | 4 | `apps/desktop/renderer/features/settings/ModelSamplingView.tsx:18`<br>`apps/desktop/renderer/features/settings/ModelSamplingView.tsx:96`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:49`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1235` | — |
| `PROVIDERS_CREATE` | `ipcProvidersCreate` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:46`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1273` | — |
| `PROVIDERS_EDIT` | `ipcProvidersEdit` | 3 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:48`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1097`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1301` | — |
| `PROVIDERS_DELETE` | `ipcProvidersDelete` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:47`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1045` | — |
| `PROVIDER_MODELS_SAVED_LIST` | `ipcProviderModelsSavedList` | 6 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:49`<br>`apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:276`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:60`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:234`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:44`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1416` | — |
| `PROVIDER_MODELS_FETCH` | `ipcProviderModelsFetch` | 2 | `apps/desktop/renderer/features/settings/FetchModelsModal.tsx:5`<br>`apps/desktop/renderer/features/settings/FetchModelsModal.tsx:67` | — |
| `PROVIDER_MODELS_SUGGEST_LIST` | `ipcProviderModelsSuggestList` | 2 | `apps/desktop/renderer/features/settings/FetchModelsModal.tsx:7`<br>`apps/desktop/renderer/features/settings/FetchModelsModal.tsx:73` | — |
| `PROVIDER_MODELS_SAVE` | `ipcProviderModelsSavedList` | 6 | `apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:49`<br>`apps/desktop/renderer/features/settings/AgentDefinitionEditorForm.tsx:276`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:60`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:234`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:44`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1416` | — |
| `PROVIDER_MODELS_DELETE_SAVED` | `ipcProviderModelsDeleteSaved` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:42`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1428` | — |
| `PROVIDER_MODELS_GET_SAVED` | `ipcProviderModelsGetSaved` | 2 | `apps/desktop/renderer/features/settings/ModelSamplingView.tsx:15`<br>`apps/desktop/renderer/features/settings/ModelSamplingView.tsx:88` | — |
| `PROVIDER_MODELS_UPDATE_SETTINGS` | `ipcProviderModelsUpdateSettings` | 3 | `apps/desktop/renderer/features/settings/ModelSamplingView.tsx:17`<br>`apps/desktop/renderer/features/settings/ModelSamplingView.tsx:159`<br>`apps/desktop/renderer/features/settings/ModelSamplingView.tsx:184` | — |
| `PROVIDER_MODELS_RESET_CONTEXT_WINDOW` | `ipcProviderModelsResetContextWindow` | 2 | `apps/desktop/renderer/features/settings/ModelSamplingView.tsx:16`<br>`apps/desktop/renderer/features/settings/ModelSamplingView.tsx:179` | — |
| `PROVIDER_MODELS_EDIT_SAVED` | `ipcProviderModelsEditSaved` | 4 | `apps/desktop/renderer/features/settings/ModelSamplingView.tsx:14`<br>`apps/desktop/renderer/features/settings/ModelSamplingView.tsx:131`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:43`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1459` | — |
| `AGENT_REGISTRY_LIST` | `ipcAgentRegistryList` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:25`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:705` | — |
| `AGENT_REGISTRY_GET` | `ipcAgentRegistryGet` | 5 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx:56`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:323`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:24`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:762`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:841` | `apps/desktop/test/settings-agents-tabs.test.ts` |
| `AGENT_REGISTRY_UPSERT` | `ipcAgentRegistryUpsert` | 6 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx:57`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:414`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:524`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:26`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:773`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:851` | — |
| `AGENT_REGISTRY_DELETE` | `ipcAgentRegistryDelete` | 4 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx:55`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:394`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:23`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:796` | — |
| `AGENT_REGISTRY_CREATE_BLANK` | `ipcAgentRegistryCreateBlank` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:22`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:731` | `apps/desktop/test/settings-agents-tabs.test.ts` |
| `AGENT_YAML_EXPORT` | `ipcAgentYamlExport` | 3 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx:58`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:702`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:29` | — |
| `AGENT_YAML_IMPORT` | `ipcAgentYamlImport` | 3 | `apps/desktop/renderer/features/settings/AgentEditorView.tsx:59`<br>`apps/desktop/renderer/features/settings/AgentEditorView.tsx:1368`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:30` | — |
| `SMART_SORT_RULE_LIST` | `ipcSmartSortRuleList` | 3 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:54`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1703`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:2237` | — |
| `SMART_SORT_RULE_CREATE` | `ipcSmartSortRuleCreate` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:51`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:2344` | — |
| `SMART_SORT_RULE_UPDATE` | `ipcSmartSortRuleUpdate` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:61`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:2332` | — |
| `SMART_SORT_RULE_DELETE` | `ipcSmartSortRuleDelete` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:52`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1756` | — |
| `SMART_SORT_RULE_DELETE_BATCH` | `ipcSmartSortRuleDeleteBatch` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:53`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1757` | — |
| `SMART_SORT_RULE_SET_ENABLED` | `ipcSmartSortRuleSetEnabled` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:59`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1727` | — |
| `SMART_SORT_RULE_SET_ENABLED_BATCH` | `ipcSmartSortRuleSetEnabledBatch` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:60`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1773` | — |
| `SMART_SORT_RULE_MOVE` | `ipcSmartSortRuleMove` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:55`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1745` | — |
| `SMART_SORT_RULE_REORDER` | `ipcSmartSortRuleReorder` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:57`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1893` | — |
| `SMART_SORT_RULE_IMPORT_RULES` | `ipcSmartSortRuleImportRules` | 0 | — | — |
| `SMART_SORT_RULE_EXPORT_RULES` | `ipcSmartSortRuleExportRules` | 0 | — | — |
| `SMART_SORT_RULE_RESET_DEFAULTS` | `ipcSmartSortRuleResetDefaults` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:58`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1824` | — |
| `SMART_SORT_RULE_MATCH` | `ipcSmartSortRuleMatch` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:56`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:2297` | — |
| `SMART_SORT_RULE_YAML_EXPORT` | `ipcSmartSortRuleYamlExport` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:62`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1788` | — |
| `SMART_SORT_RULE_YAML_IMPORT` | `ipcSmartSortRuleYamlImport` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:63`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:1803` | — |
| `SKILLS_LIST` | `ipcSkillsList` | 6 | `apps/desktop/renderer/features/settings/SkillDetailView.tsx:63`<br>`apps/desktop/renderer/features/settings/SkillsManageView.tsx:19`<br>`apps/desktop/renderer/features/settings/SkillsManageView.tsx:86`<br>`apps/desktop/renderer/features/settings/SkillsManageView.tsx:88`<br>`apps/desktop/renderer/features/skills/NewSkillModal.tsx:19`<br>`apps/desktop/renderer/features/skills/NewSkillModal.tsx:132` | — |
| `SKILLS_EFFECTIVE` | `ipcSkillsEffective` | 5 | `apps/desktop/renderer/features/chat/ChatComposer.tsx:15`<br>`apps/desktop/renderer/features/chat/ChatComposer.tsx:209`<br>`apps/desktop/renderer/features/chat/SessionSkillPanel.tsx:13`<br>`apps/desktop/renderer/features/chat/SessionSkillPanel.tsx:38`<br>`apps/desktop/renderer/features/skills/SkillPicker.tsx:35` | — |
| `SKILLS_READ` | `ipcSkillsRead` | 1 | `apps/desktop/renderer/features/settings/SkillDetailView.tsx:84` | `apps/desktop/test/skill-zip-import.test.tsx` |
| `SKILLS_WRITE` | `ipcSkillsWrite` | 5 | `apps/desktop/renderer/features/settings/SkillDetailView.tsx:167`<br>`apps/desktop/renderer/features/settings/SkillDetailView.tsx:203`<br>`apps/desktop/renderer/features/skills/NewSkillModal.tsx:20`<br>`apps/desktop/renderer/features/skills/NewSkillModal.tsx:180`<br>`apps/desktop/renderer/features/skills/NewSkillModal.tsx:195` | — |
| `SKILLS_EDIT` | `ipcSkillsEdit` | 0 | — | — |
| `SKILLS_TOGGLE` | `ipcSkillsToggle` | 2 | `apps/desktop/renderer/features/chat/SessionSkillPanel.tsx:14`<br>`apps/desktop/renderer/features/chat/SessionSkillPanel.tsx:63` | — |
| `SKILLS_DELETE` | `ipcSkillsDelete` | 2 | `apps/desktop/renderer/features/settings/SkillsManageView.tsx:18`<br>`apps/desktop/renderer/features/settings/SkillsManageView.tsx:361` | — |
| `SKILLS_ASSERT_CREATE_NAME` | `ipcSkillsAssertCreateName` | 2 | `apps/desktop/renderer/features/skills/NewSkillModal.tsx:18`<br>`apps/desktop/renderer/features/skills/NewSkillModal.tsx:150` | `apps/desktop/test/skill-zip-import.test.tsx` |
| `SKILLS_UPDATE_INFO` | `ipcSkillsUpdateInfo` | 1 | `apps/desktop/renderer/features/skills/SkillInfoEditModal.tsx:74` | — |
| `COMPACTION_CONDITIONS_GET` | `ipcCompactionConditionsGet` | 2 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:8`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:68` | — |
| `COMPACTION_CONDITIONS_SET` | `ipcCompactionConditionsSet` | 2 | `apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:9`<br>`apps/desktop/renderer/features/settings/WorkspaceSettingsView.tsx:141` | — |
| `BACKUP_EXPORT` | `ipcBackupExport` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:31`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:354` | — |
| `BACKUP_IMPORT` | `ipcBackupImport` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:32`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:371` | — |
| `DB_STATS` | `ipcDbStats` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:34`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:184` | — |
| `DB_MAINTENANCE` | `ipcDbMaintenance` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:33`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:393` | `apps/desktop/test/settings-db-maintenance-ui.test.ts` |
| `CLOUD_SYNC_GET_CONFIG` | `ipcCloudSyncGetConfig` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:35`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:196` | — |
| `CLOUD_SYNC_SET_CONFIG` | `ipcCloudSyncSetConfig` | 3 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:39`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:240`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:283` | — |
| `CLOUD_SYNC_SET_ENABLED` | `ipcCloudSyncSetEnabled` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:40`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:268` | — |
| `CLOUD_SYNC_TEST_CONNECTION` | `ipcCloudSyncTestConnection` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:41`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:297` | — |
| `CLOUD_SYNC_GET_LOCAL_STATUS` | `ipcCloudSyncGetLocalStatus` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:36`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:175` | — |
| `CLOUD_SYNC_PULL` | `ipcCloudSyncPull` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:37`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:313` | — |
| `CLOUD_SYNC_PUSH` | `ipcCloudSyncPull` | 2 | `apps/desktop/renderer/features/settings/SettingsViews.tsx:37`<br>`apps/desktop/renderer/features/settings/SettingsViews.tsx:313` | — |
| `SEARCH_GET_CONFIG` | `ipcSearchGetConfig` | 3 | `apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:17`<br>`apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:65`<br>`apps/desktop/renderer/features/settings/SearchEnginesView.tsx:86` | — |
| `SEARCH_SAVE_ENGINE_KEY` | `ipcSearchSaveEngineKey` | 2 | `apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:18`<br>`apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:146` | — |
| `SEARCH_CLEAR_ENGINE_KEY` | `ipcSearchClearEngineKey` | 2 | `apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:16`<br>`apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:119` | — |
| `SEARCH_SET_SEARXNG_BASE_URL` | `ipcSearchSetSearxngBaseUrl` | 2 | `apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:19`<br>`apps/desktop/renderer/features/settings/SearchEngineDetailView.tsx:161` | — |
| `SEARCH_SET_ENGINE_ORDER` | `ipcSearchSetEngineOrder` | 1 | `apps/desktop/renderer/features/settings/SearchEnginesView.tsx:111` | — |
| `SHELL_MENU_POPUP` | `ipcShellMenuPopup` | 1 | `apps/desktop/renderer/layout/AppMenuBar.tsx:17` | — |
| `SHELL_SET_TITLEBAR_THEME` | `ipcShellMenuPopup` | 1 | `apps/desktop/renderer/layout/AppMenuBar.tsx:17` | — |
| `SHELL_OPEN_EXTERNAL` | `ipcAppOpenExternal` | 7 | `apps/desktop/renderer/features/settings/AboutView.tsx:6`<br>`apps/desktop/renderer/features/settings/AboutView.tsx:103`<br>`apps/desktop/renderer/features/settings/AboutView.tsx:122`<br>`apps/desktop/renderer/hooks/useAutoUpdateCheck.tsx:8`<br>`apps/desktop/renderer/hooks/useAutoUpdateCheck.tsx:130`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:45`<br>`apps/desktop/renderer/providers/ShellNavProvider.tsx:403` | `apps/desktop/test/chat-link-route.test.ts` |
| `USAGE_STATS_QUERY` | `ipcUsageStatsQuery` | 7 | `apps/desktop/renderer/features/chat/MetricsDetailPopover.tsx:57`<br>`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:431`<br>`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:433`<br>`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:499`<br>`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:544`<br>`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:583`<br>`apps/desktop/renderer/features/settings/TokenUsageStatsView.tsx:688` | `apps/desktop/test/metrics-detail-popover.test.tsx` |
| `APP_GET_INFO` | `ipcAppGetInfo` | 2 | `apps/desktop/renderer/features/settings/AboutView.tsx:5`<br>`apps/desktop/renderer/features/settings/AboutView.tsx:46` | — |
| `APP_CHECK_FOR_UPDATES` | `ipcAppCheckForUpdates` | 4 | `apps/desktop/renderer/features/settings/AboutView.tsx:4`<br>`apps/desktop/renderer/features/settings/AboutView.tsx:85`<br>`apps/desktop/renderer/hooks/useAutoUpdateCheck.tsx:7`<br>`apps/desktop/renderer/hooks/useAutoUpdateCheck.tsx:85` | — |

## 已知局限

- `ipcMain.on`（renderer → main `send`）通道没有 renderer 侧 invoke 封装（`VFS_START_DRAG`），本表按 invoke 型处理，① 层用 `ipcMain.on` 判据、③ 层自然报「未封装」——这是预期形态，不是缺陷（preload 的 `startDrag()` 专用方法走 `ipcRenderer.send`）。
- ⑤ 层是文本 grep：同名局部变量、包装函数再导出、动态 `client[key]` 调用都会漏。`tests` 列单独标出「只有测试在用」——这类通常意味着封装是给测试预留的。
- ② 层只认 `export function/const/class`；handler 定义在 `export const x = (…) => …` 形式下能识别，定义在 class 静态方法或对象字面量里的会判缺失。
- 预加载 `preload.ts` 暴露的是通用 `invoke/on/off` 桥 + `getPathForFile` / `startDrag` 两个专用方法，本机位不把 preload 当独立层（它是通用桥，不是逐通道封装）。