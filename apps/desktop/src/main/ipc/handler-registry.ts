/**
 * IPC invoke 映射表（main 侧）：channel → handler 一行注册。
 */
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "../../../shared/ipc-types.js";
import { AppUi } from "./handlers/app-ui.js";
import { Agent } from "./handlers/agent.js";
import { RunAbort } from "./handlers/run-abort.js";
import { agentActivity } from "../runtime/agent-activity.js";
import { Bootstrap } from "./handlers/bootstrap.js";
import { CompactionIpc } from "./handlers/compaction.js";
import { CompactionConditions } from "./handlers/compaction-conditions.js";
import { AgentRegistry } from "./handlers/agent-registry.js";
import { Backup } from "./handlers/backup.js";
import { DbMaintenance } from "./handlers/db-maintenance.js";
import { CloudSync } from "./handlers/cloud-sync.js";
import { Search } from "./handlers/search.js";
import { Mcp } from "./handlers/mcp.js";
import { AppInfo } from "./handlers/app-info.js";
import { Shell } from "./handlers/shell.js";
import { Preferences, PREFERENCE_FEATURES, type PreferenceFeature } from "./handlers/preferences.js";
import { ProviderModels } from "./handlers/provider-models.js";
import { Providers } from "./handlers/providers.js";
import { SmartSortRule } from "./handlers/smart-sort-rule.js";
import { Skills } from "./handlers/skills.js";
import { Messages } from "./handlers/messages.js";
import { Prompt } from "./handlers/prompt.js";
import { UsageStats } from "./handlers/usage-stats.js";
import { Projects } from "./handlers/projects.js";
import { Scope } from "./handlers/scope.js";

import { Sessions } from "./handlers/sessions.js";
import { Physical } from "./handlers/physical.js";
import { Vfs } from "./handlers/vfs.js";
import { VfsBatchService } from "../services/vfs-batch.service.js";
import { FormatIpcError } from "./format-ipc-error.js";
import { LogFactory } from "@novel-master/core/log";
import type { VfsStartDragFailedPayload, VfsStartDragRequest } from "../../../shared/ipc-types.js";

const dragLog = LogFactory.create("desktop.ipc.vfs");
import { Workplace } from "./handlers/workplace.js";

type NoArgHandler = () => unknown;
type BoolHandler = (enabled: boolean) => unknown;

export const HandlerRegistry = {
    bindNoArg(channel: string, handler: NoArgHandler): void {
        ipcMain.handle(channel, () => handler());
    },

    /** 注册带请求体的 invoke；泛型保留各 handler 的 req 类型，避免 unknown 逆变报错。 */
    bindReq<T>(channel: string, handler: (req: T) => unknown): void {
        ipcMain.handle(channel, (_event, req) => handler(req as T));
    },

    bindBool(channel: string, handler: BoolHandler): void {
        ipcMain.handle(channel, (_event, enabled: boolean) => handler(enabled));
    },

    bindEventReq<T>(channel: string, handler: (event: IpcMainInvokeEvent, req: T) => unknown): void {
        ipcMain.handle(channel, (event, req) => handler(event, req as T));
    },

    /** 按映射表注册全部 ipcMain.handle（main.ts 启动序列直调）。 */
    register(): void {
        HandlerRegistry.bindNoArg(IPC_CHANNELS.BOOTSTRAP_STATUS, Bootstrap.status);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.BOOTSTRAP_REBOOTSTRAP, Bootstrap.rebootstrap);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.SCOPE_GET, Scope.get);
        HandlerRegistry.bindReq(IPC_CHANNELS.SCOPE_SET_PROJECT, Scope.setProject);
        HandlerRegistry.bindReq(IPC_CHANNELS.SCOPE_SET_SESSION, Scope.setSession);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.PROJECTS_LIST, Projects.list);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROJECTS_CREATE, Projects.create);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROJECTS_RENAME, Projects.rename);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROJECTS_DELETE, Projects.delete);

        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_LIST_BY_PROJECT, Sessions.listByProject);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_CREATE, Sessions.create);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_RENAME, Sessions.rename);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_DELETE, Sessions.remove);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_PULL_TEMPLATE, Sessions.pullTemplate);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_PUSH_TEMPLATE, Sessions.pushTemplate);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_GET_COMPOSER_DRAFT, Sessions.getComposerDraft);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_SET_COMPOSER_DRAFT, Sessions.setComposerDraft);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_PROJECT_COMPOSER_STATUS, Sessions.projectComposerStatus);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_SET_AGENT_BINDING, Sessions.setAgentBinding);
        HandlerRegistry.bindReq(IPC_CHANNELS.SESSIONS_SET_MODEL_OVERRIDE, Sessions.setModelOverride);

        HandlerRegistry.bindReq(IPC_CHANNELS.APP_UI_GET, AppUi.get);
        HandlerRegistry.bindReq(IPC_CHANNELS.APP_UI_SET, AppUi.set);

        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_READ, Vfs.read);
        // 只读物理树浏览（跨域拼接视图；仅 list/read，无任何写通道）
        HandlerRegistry.bindReq(IPC_CHANNELS.PHYSICAL_LIST, Physical.list);
        HandlerRegistry.bindReq(IPC_CHANNELS.PHYSICAL_READ, Physical.read);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_WRITE, Vfs.write);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_MKDIR, Vfs.mkdir);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_DELETE, Vfs.remove);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_RENAME, Vfs.rename);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_ZIP_EXPORT, Vfs.exportZip);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_ZIP_IMPORT, Vfs.importZip);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.VFS_ZIP_PICK, Vfs.pickZip);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_ZIP_IMPORT_BYTES, Vfs.importZipBytes);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_CHARACTER_CARD_IMPORT, Vfs.characterCardImport);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.VFS_FILE_PICK, Vfs.filePick);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_FILE_EXPORT, Vfs.fileExport);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_BATCH_INGEST_FROM_PATHS, Vfs.batchIngestFromPaths);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_BATCH_EXPORT_STAGE, Vfs.batchExportStage);
        HandlerRegistry.bindReq(IPC_CHANNELS.VFS_BATCH_CLEAR_STAGING, Vfs.batchClearStaging);
        // startDrag 须在 drag 流程中同步触发，使用 send 而非 invoke；失败经 VFS_START_DRAG_FAILED 回传
        // （原 handleVfsStartDrag 内联：preload 经 ipcRenderer.send 触发，失败推回 renderer toast）
        ipcMain.on(IPC_CHANNELS.VFS_START_DRAG, (event, req: VfsStartDragRequest) => {
            try {
                const dragResult = VfsBatchService.startDragExport(event.sender, req.filePaths ?? []);
                if (!dragResult.ok) {
                    dragLog.error("vfs-batch startDrag failed", { error: dragResult.error });
                    const payload: VfsStartDragFailedPayload = {
                        message: FormatIpcError.format(dragResult.error).message || "拖出失败",
                    };
                    if (!event.sender.isDestroyed()) {
                        event.sender.send(IPC_CHANNELS.VFS_START_DRAG_FAILED, payload);
                    }
                }
            } catch (err) {
                dragLog.error("vfs-batch startDrag failed", { error: err });
                const payload: VfsStartDragFailedPayload = {
                    message: FormatIpcError.format(err).message || "拖出失败",
                };
                if (!event.sender.isDestroyed()) {
                    event.sender.send(IPC_CHANNELS.VFS_START_DRAG_FAILED, payload);
                }
            }
        });

        HandlerRegistry.bindReq(IPC_CHANNELS.WORKPLACE_BUILD_LIST_ROWS, Workplace.buildListRows);
        HandlerRegistry.bindReq(IPC_CHANNELS.WORKPLACE_SET_DIR_RULE, Workplace.setDirRule);
        HandlerRegistry.bindReq(IPC_CHANNELS.WORKPLACE_SET_FILE_RULE, Workplace.setFileRule);
        HandlerRegistry.bindReq(IPC_CHANNELS.WORKPLACE_GET_DIR_RULE, Workplace.getDirRule);

        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_LIST, Messages.list);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_APPEND, Messages.append);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_EDIT, Messages.edit);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_HIDE, Messages.hide);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_SHOW, Messages.show);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_HIDE_RANGE, Messages.hideRange);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_SHOW_RANGE, Messages.showRange);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_TRUNCATE_AFTER, Messages.truncateAfter);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_DELETE, Messages.remove);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_FORK, Messages.fork);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_ROLLBACK, Messages.rollback);
        HandlerRegistry.bindReq(IPC_CHANNELS.MESSAGES_SET_FLOOR, Messages.setFloor);

        HandlerRegistry.bindReq(IPC_CHANNELS.USAGE_STATS_QUERY, UsageStats.handleQuery);

        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_RUN, Agent.run);
        // 取消入口：nm:agent/abort 是转发别名（转 ABORT_KEY.agent），nm:run/abort 按
        // { kind, id } 分发到 6 类长任务的 key 命名空间。
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_ABORT, RunAbort.abortAlias);
        HandlerRegistry.bindReq(IPC_CHANNELS.NM_RUN_ABORT, RunAbort.abort);
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_RUN_IS_ACTIVE, Agent.runIsActive);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.AGENT_ACTIVITY_GET, () => ({
            active: agentActivity.isActive(),
        }));
        HandlerRegistry.bindNoArg(IPC_CHANNELS.AGENT_RESOLVE_CURRENT, Agent.resolveCurrent);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.AGENT_LIST_PICKER, Agent.listPicker);
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_SET_CURRENT, Agent.setCurrent);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.MODEL_LIST_PICKER, Agent.modelListPicker);
        HandlerRegistry.bindReq(IPC_CHANNELS.MODEL_SET_CURRENT, Agent.modelSetCurrent);

        HandlerRegistry.bindReq(IPC_CHANNELS.PROMPT_REAL_PREVIEW, Prompt.realPreview);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROMPT_CHAT_TOKEN_LABEL, Prompt.chatTokenLabel);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROMPT_AGENT_META, Prompt.agentMeta);

        HandlerRegistry.bindReq(IPC_CHANNELS.COMPACTION_MANUAL, CompactionIpc.handleManual);

        // 布尔偏好：feature 表是唯一来源（含 VFS 统一 tool turn），新增开关只加表内一行。
        for (const feature of Object.keys(PREFERENCE_FEATURES) as PreferenceFeature[]) {
            HandlerRegistry.bindNoArg(PREFERENCE_FEATURES[feature].getChannel, () => Preferences.get(feature));
            HandlerRegistry.bindBool(PREFERENCE_FEATURES[feature].setChannel, (enabled) => Preferences.set(feature, enabled));
        }

        HandlerRegistry.bindNoArg(IPC_CHANNELS.PROVIDERS_LIST, Providers.list);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDERS_GET, Providers.get);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDERS_CREATE, Providers.create);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDERS_EDIT, Providers.edit);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDERS_DELETE, Providers.delete);

        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_SAVED_LIST, ProviderModels.savedList);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_FETCH, ProviderModels.fetch);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_SUGGEST_LIST, ProviderModels.suggestList);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_SAVE, ProviderModels.save);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_DELETE_SAVED, ProviderModels.deleteSaved);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_GET_SAVED, ProviderModels.getSaved);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_UPDATE_SETTINGS, ProviderModels.updateSettings);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_RESET_CONTEXT_WINDOW, ProviderModels.resetContextWindow);
        HandlerRegistry.bindReq(IPC_CHANNELS.PROVIDER_MODELS_EDIT_SAVED, ProviderModels.editSaved);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.AGENT_REGISTRY_LIST, AgentRegistry.list);
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_REGISTRY_GET, AgentRegistry.get);
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_REGISTRY_UPSERT, AgentRegistry.upsert);
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_REGISTRY_UPDATE, AgentRegistry.update);
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_REGISTRY_DELETE, AgentRegistry.remove);
        // 可选 payload：renderer 不传参时 req 为 undefined，handler 侧容忍（现行为回归）。
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_REGISTRY_CREATE_BLANK, AgentRegistry.createBlank);
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_YAML_EXPORT, AgentRegistry.exportYaml);
        HandlerRegistry.bindReq(IPC_CHANNELS.AGENT_YAML_IMPORT, AgentRegistry.importYaml);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.SMART_SORT_RULE_LIST, SmartSortRule.list);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_CREATE, SmartSortRule.create);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_UPDATE, SmartSortRule.update);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_DELETE, SmartSortRule.remove);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_DELETE_BATCH, SmartSortRule.deleteBatch);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_SET_ENABLED, SmartSortRule.setEnabled);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_SET_ENABLED_BATCH, SmartSortRule.setEnabledBatch);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_MOVE, SmartSortRule.move);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_REORDER, SmartSortRule.reorder);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.SMART_SORT_RULE_RESET_DEFAULTS, SmartSortRule.resetDefaults);
        HandlerRegistry.bindReq(IPC_CHANNELS.SMART_SORT_RULE_MATCH, SmartSortRule.match);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.SMART_SORT_RULE_YAML_EXPORT, SmartSortRule.exportYaml);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.SMART_SORT_RULE_YAML_IMPORT, SmartSortRule.importYaml);

        HandlerRegistry.bindReq(IPC_CHANNELS.SKILLS_LIST, Skills.list);
        HandlerRegistry.bindReq(IPC_CHANNELS.SKILLS_EFFECTIVE, Skills.effective);
        HandlerRegistry.bindReq(IPC_CHANNELS.SKILLS_READ, Skills.read);
        HandlerRegistry.bindReq(IPC_CHANNELS.SKILLS_WRITE, Skills.write);
        HandlerRegistry.bindReq(IPC_CHANNELS.SKILLS_TOGGLE, Skills.toggle);
        HandlerRegistry.bindReq(IPC_CHANNELS.SKILLS_DELETE, Skills.remove);
        HandlerRegistry.bindReq(IPC_CHANNELS.SKILLS_ASSERT_CREATE_NAME, Skills.assertCreateName);
        HandlerRegistry.bindReq(IPC_CHANNELS.SKILLS_UPDATE_INFO, Skills.updateInfo);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.COMPACTION_CONDITIONS_GET, CompactionConditions.get);
        HandlerRegistry.bindReq(IPC_CHANNELS.COMPACTION_CONDITIONS_SET, CompactionConditions.set);

        // 可选请求体 `{ runId? }`：renderer 只为会展示取消按钮的任务生成 runId，
        // 缺省时 handler 只建 scope + deadline、不注册进 abort registry（既有调用零改动）。
        HandlerRegistry.bindReq(IPC_CHANNELS.BACKUP_EXPORT, Backup.handleExport);
        HandlerRegistry.bindReq(IPC_CHANNELS.BACKUP_IMPORT, Backup.handleImport);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.DB_STATS, DbMaintenance.handleDbStats);
        HandlerRegistry.bindReq(IPC_CHANNELS.DB_MAINTENANCE, DbMaintenance.handle);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.CLOUD_SYNC_GET_CONFIG, CloudSync.getConfig);
        HandlerRegistry.bindReq(IPC_CHANNELS.CLOUD_SYNC_SET_CONFIG, CloudSync.setConfig);
        HandlerRegistry.bindBool(IPC_CHANNELS.CLOUD_SYNC_SET_ENABLED, CloudSync.setEnabled);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.CLOUD_SYNC_TEST_CONNECTION, CloudSync.testConnection);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.CLOUD_SYNC_GET_LOCAL_STATUS, CloudSync.getLocalStatus);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.CLOUD_SYNC_PULL, CloudSync.pull);
        HandlerRegistry.bindReq(IPC_CHANNELS.CLOUD_SYNC_PUSH, CloudSync.push);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.SEARCH_GET_CONFIG, Search.getConfig);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_SAVE_ENGINE_KEY, Search.saveEngineKey);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_CLEAR_ENGINE_KEY, Search.clearEngineKey);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_SET_ENGINE_ORDER, Search.setEngineOrder);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_SET_ENABLED, Search.setEnabled);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_SET_ENGINE_BASE_URL, Search.setEngineBaseUrl);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_CREATE_CUSTOM_ENGINE, Search.createCustomEngine);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_UPDATE_CUSTOM_ENGINE, Search.updateCustomEngine);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_DELETE_CUSTOM_ENGINE, Search.deleteCustomEngine);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_UPDATE_PRESET_OVERRIDE, Search.updatePresetOverride);
        HandlerRegistry.bindReq(IPC_CHANNELS.SEARCH_RESET_PRESET_OVERRIDE, Search.resetPresetOverride);

        // MCP 配置（mcp-support Step 13/14）：CRUD / 测试连接 / OAuth 发起与回调 / 快照与状态读取
        HandlerRegistry.bindNoArg(IPC_CHANNELS.MCP_LIST_SERVERS, Mcp.listServers);
        HandlerRegistry.bindReq(IPC_CHANNELS.MCP_SAVE_SERVER, Mcp.saveServer);
        HandlerRegistry.bindReq(IPC_CHANNELS.MCP_DELETE_SERVER, Mcp.deleteServer);
        HandlerRegistry.bindReq(IPC_CHANNELS.MCP_TEST_CONNECTION, Mcp.testConnection);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.MCP_SERVER_STATUSES, Mcp.listServerStatuses);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.MCP_TOOLS_SNAPSHOT, Mcp.toolsSnapshot);
        HandlerRegistry.bindReq(IPC_CHANNELS.MCP_TOOL_LIST, Mcp.toolList);
        HandlerRegistry.bindReq(IPC_CHANNELS.MCP_SET_TOOL_DISABLED, Mcp.setToolDisabled);
        HandlerRegistry.bindReq(IPC_CHANNELS.MCP_OAUTH_START, Mcp.oauthStart);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.MCP_OAUTH_STATUSES, Mcp.oauthStatuses);

        HandlerRegistry.bindEventReq(IPC_CHANNELS.SHELL_MENU_POPUP, Shell.menuPopup);
        HandlerRegistry.bindEventReq(IPC_CHANNELS.SHELL_SET_TITLEBAR_THEME, Shell.setTitleBarTheme);
        HandlerRegistry.bindReq(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, AppInfo.openExternal);

        HandlerRegistry.bindNoArg(IPC_CHANNELS.APP_GET_INFO, AppInfo.getInfo);
        HandlerRegistry.bindNoArg(IPC_CHANNELS.APP_CHECK_FOR_UPDATES, AppInfo.checkForUpdates);
    },
} as const;
