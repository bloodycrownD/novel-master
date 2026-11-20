/**
 * Minimal `@novel-master/core` shim for mobile Jest tests.
 *
 * @remarks
 * The real core barrel (`packages/core/dist/index.js`) exports the prompt YAML
 * helpers which depend on the `yaml` package browser ESM entry. React Native
 * Jest preset does not transform that dependency by default, causing
 * `SyntaxError: Cannot use import statement outside a module`.
 *
 * Mobile unit tests only need error classes, so we re-export just those.
 */

// per-domain 错误类已退役（统一 new AppError(key, params)），shim 只留双形态守卫。
export {isVfsError} from '../../../packages/core/dist/errors/guards.js';
export {VfsZipBuild} from '../../../packages/core/dist/domain/vfs/logic/vfs-zip-build.js';
export {VfsZipParse} from '../../../packages/core/dist/domain/vfs/logic/vfs-zip-parse.js';
export {VfsServiceFactory} from '../../../packages/core/dist/public/vfs.js';
export {TdbcError} from '../../../packages/core/dist/infra/tdbc/errors.js';
// db-backup 导入前的 SQLite 头校验（十七期下沉 core，desktop/mobile 同源）。
export {SqliteBackupHeader} from '../../../packages/core/dist/infra/db-backup/sqlite-backup-header.js';
// 跨端控制流哨兵（十九期上收 core）：desktop / mobile / core 导入同一份类，
// `instanceof` 才跨包成立。直连窄文件，不拉主 barrel（避开 yaml ESM 入口）。
export {DatabaseReplacedError} from '../../../packages/core/dist/infra/cloud-sync/model/database-replaced-error.js';
export {ChatPromptBuildBailedError} from '../../../packages/core/dist/service/chat/model/chat-prompt-build-bailed-error.js';
export {AppError} from '../../../packages/core/dist/errors/app-error.js';
// Result 同时是值（ok/err 静态入口）与类型（Ok|Err 联合）：云同步测试按
// coordinator 的 Result 通道造 mock 返回值（错误通道迁移四期适配）。
export {Result} from '../../../packages/core/dist/errors/either.js';
// 路径前缀归一已收敛到 common/Path（ensureTrailingSlash 成员）；statusKey 随
// CloudSyncPaths（infra/cloud-sync/logic/paths.js）导出，shim 消费者直连即可。
export {CloudSyncCoordinator, CloudSyncStatusParser} from '../../../packages/core/dist/infra/cloud-sync/index.js';
export type {KkvService} from '../../../packages/core/dist/service/kkv/kkv.port.js';
export {DepthSlice} from '../../../packages/core/dist/domain/depth/logic/depth-slice.js';
export {WorkplaceEval} from '../../../packages/core/dist/domain/workplace/logic/workplace-eval.js';
export {DEFAULT_WORKPLACE_DIR_RULE} from '../../../packages/core/dist/domain/workplace/logic/default-dir-rule.js';
export type {WorkplaceDirRule, WorkplaceListRow} from '../../../packages/core/dist/domain/workplace/model/workplace-types.js';
export {TextBlocks} from '../../../packages/core/dist/domain/chat/content/text-blocks.js';
export {ToolRegistry} from '../../../packages/core/dist/domain/tool/logic/tool-registry.js';
export {ToolResultBlock} from '../../../packages/core/dist/domain/tool/logic/build-tool-result-block.js';
export {BuiltinTools} from '../../../packages/core/dist/domain/tool/builtin/register-builtin-tools.js';
export {AgentTools} from '../../../packages/core/dist/domain/agent/logic/resolve-agent-tools.js';
export {AgentDefinitionValidator} from '../../../packages/core/dist/domain/agent/logic/validate-agent-definition.js';
export {AgentServiceFactory} from '../../../packages/core/dist/public/agent.js';
export {ChatAgentSession} from '../../../packages/core/dist/service/agent/impl/chat-agent-session.js';
export {AGENT_RUN_RESOLVE_KEYS, AgentRunShared} from '../../../packages/core/dist/service/agent/logic/agent-run-shared.js';
export {AgentTurnRunner} from '../../../packages/core/dist/service/agent/logic/run-agent-turn.js';
export type {AgentDefinition} from '../../../packages/core/dist/domain/agent/model/agent-definition.js';
export type {AgentRunResult} from '../../../packages/core/dist/domain/agent/model/agent-run-result.js';
// 搜索 curl 化（web-search-curl Step 7）：mobile 生产/测试实际引用的新导出
// （生产走 metro 直连 dist barrel，本 shim 是 Jest 白名单——只补有引用的符号）。
export {PRESET_ENGINE_TEMPLATES} from '../../../packages/core/dist/domain/tool/builtin/search/preset-templates.js';
export {SearchEngine} from '../../../packages/core/dist/domain/tool/builtin/search/types.js';
export {DEFAULT_USER_VFS_UNIFIED_TOOL_TURN, userVfsUnifiedToolTurnFlag} from '../../../packages/core/dist/domain/feature-flags/user-vfs-unified-tool-turn.js';
export {userVfsTurns, USER_VFS_TURN_SPAN} from '../../../packages/core/dist/domain/chat/logic/vfs-turn/user-vfs-turn-view.js';
export {UserVfsTurnPreview} from '../../../packages/core/dist/presentation/chat/user-vfs-turn-preview.js';
export {USER_VFS_TURN_ACK_TEXT, userVfsTurnStorage} from '../../../packages/core/dist/domain/chat/logic/vfs-turn/user-vfs-turn-constants.js';
export type {ParsedUserVfsAction, ParsedUserVfsEditHunk, UserVfsTurnView} from '../../../packages/core/dist/domain/chat/logic/vfs-turn/user-vfs-turn-view.js';
