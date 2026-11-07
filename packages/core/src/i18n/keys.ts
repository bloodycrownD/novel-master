/**
 * core 用户可见文案的 key 契约（error.* + label.*）。
 *
 * 文案本体在 `./catalog/zh-CN.yaml`（唯一真源）；本文件只定义 key 与
 * descriptor 类型，不含任何用户可见文本。keyRule 与域词表见
 * docs/Iterations/i18n-normalization/spec.md §2.2：
 * `^(error|label)\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$`，段名全小写
 * snake_case；同一 code 多原因/多方向追加子段；参数占位 `{snake_case}`。
 *
 * @module i18n/keys
 */

import type { MessageDescriptor } from "@/common/i18n.js";

/** keyRule 的可执行形态；parseCoreCatalog 与 catalog 测试共用。 */
export const CORE_MESSAGE_KEY_PATTERN = /^(error|label)\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$/;

/** error.* 第二段（域）的固定词表（spec §2.2，19 域）。 */
export const ERROR_KEY_DOMAINS = [
  "agent",
  "vfs",
  "chat",
  "skill",
  "provider",
  "session_fs",
  "compaction",
  "smart_sort_rule",
  "preferences",
  "infra",
  "format",
  "kkv",
  "depth",
  "prompt",
  "workplace",
  "cloud_sync",
  "db_backup",
  "usage",
  "tool",
] as const;

/** label.* 第二段（域）的固定词表（spec §2.2，9 域；用不到的域不预留）。 */
export const LABEL_KEY_DOMAINS = [
  "agent",
  "attachment",
  "chat",
  "provider",
  "workplace",
  "token_source",
  "stream_metrics",
  "prompt_preview",
  "smart_sort",
] as const;

/** 错误消息 key（A 桶 187 处去重后的全量清单）。 */
const ERROR_MESSAGE_KEYS = [
  // agent：定义校验 / 注册表 / 运行前置
  "error.agent.invalid_schema.name_required",
  "error.agent.invalid_schema.description_type",
  "error.agent.invalid_schema.prompts_shape",
  "error.agent.invalid_schema.field_invalid",
  "error.agent.invalid_schema.workplace_nonempty_string",
  "error.agent.invalid_schema.custom_attach_nonempty_string",
  "error.agent.invalid_schema.skills_prefix_nonempty_string",
  "error.agent.invalid_schema.builtin_name_reserved",
  "error.agent.invalid_schema.builtin_not_deletable",
  "error.agent.duplicate_name",
  "error.agent.not_configured",
  "error.agent.not_found",
  "error.agent.model_not_set",
  "error.agent.referenced_not_found",
  "error.agent.message_empty",
  "error.agent.subagent_model_missing",
  "error.agent.grandchild_model_missing",
  "error.agent.child_session_busy",
  // chat：zod schema / 会话创建
  "error.chat.attachment_path_blank",
  "error.chat.annotate_render_range_pair_required",
  "error.chat.annotate_render_range_order",
  "error.chat.annotate_offset_pair_required",
  "error.chat.annotate_offset_order",
  "error.chat.composer_token_range_order",
  "error.chat.attachment_skill_name_required",
  "error.chat.attachment_name_display_tag_forbidden",
  "error.chat.attachment_name_storage_mismatch",
  "error.chat.project_agent_definition_required",
  "error.chat.session_create_agent_missing",
  // cloud_sync：方向与原因入子段
  "error.cloud_sync.already_up_to_date",
  "error.cloud_sync.snapshot_missing",
  "error.cloud_sync.download_checksum_mismatch",
  "error.cloud_sync.agent_active.pull",
  "error.cloud_sync.agent_active.push",
  "error.cloud_sync.push_mutex_timeout.pull",
  "error.cloud_sync.push_mutex_timeout.push",
  "error.cloud_sync.need_pull_first.remote_ahead",
  "error.cloud_sync.need_pull_first.advanced_by_other",
  "error.cloud_sync.lock_held_by_other",
  "error.cloud_sync.lock_contention",
  "error.cloud_sync.not_configured",
  "error.cloud_sync.invalid_status.unparseable",
  "error.cloud_sync.invalid_status.schema_invalid",
  // db_backup：provider 三表快照校验（每条原因一个 key，参数带行号）
  "error.db_backup.provider_row_id_missing",
  "error.db_backup.provider_row_protocol_invalid",
  "error.db_backup.provider_row_base_url_empty",
  "error.db_backup.provider_row_display_name_empty",
  "error.db_backup.provider_row_is_builtin_not_number",
  "error.db_backup.provider_row_timestamp_invalid",
  "error.db_backup.saved_model_row_provider_id_empty",
  "error.db_backup.saved_model_row_vendor_model_id_empty",
  "error.db_backup.saved_model_row_settings_json_missing",
  "error.db_backup.dangling_saved_model",
  "error.db_backup.secret_row_ref_missing",
  "error.db_backup.secret_row_ciphertext_missing",
  "error.db_backup.secret_row_algo_empty",
  "error.db_backup.secret_row_version_not_number",
  // infra：启动基线
  "error.infra.baseline_too_old",
  // prompt：布局校验与动态宏校验（PROMPT_INVALID_LAYOUT / PROMPT_INVALID_MACRO）
  "error.prompt.invalid_layout.workplace_nonempty_string",
  "error.prompt.invalid_layout.workplace_type",
  "error.prompt.invalid_layout.region_map_not_array",
  "error.prompt.invalid_layout.region_map_required",
  "error.prompt.invalid_layout.system_nonempty_string",
  "error.prompt.invalid_layout.block_name_required",
  "error.prompt.invalid_layout.block_not_object",
  "error.prompt.invalid_layout.persist_worktree_removed",
  "error.prompt.invalid_layout.persist_block_text_only",
  "error.prompt.invalid_layout.when_removed",
  "error.prompt.invalid_layout.persist_system_role",
  "error.prompt.invalid_layout.persist_role",
  "error.prompt.invalid_layout.text_content_required",
  "error.prompt.invalid_layout.dynamic_block_text_only",
  "error.prompt.invalid_layout.dynamic_system_role",
  "error.prompt.invalid_layout.dynamic_role",
  "error.prompt.invalid_layout.persist_needs_blocks",
  "error.prompt.invalid_layout.persist_last_role",
  "error.prompt.invalid_layout.dynamic_needs_two_blocks",
  "error.prompt.invalid_layout.dynamic_first_role",
  "error.prompt.invalid_layout.dynamic_last_role",
  "error.prompt.invalid_layout.duplicate_block_name",
  "error.prompt.invalid_macro.scan_failed",
  "error.prompt.invalid_macro.worktree_removed",
  "error.prompt.invalid_macro.filetree_alias",
  "error.prompt.invalid_macro.dot_removed",
  "error.prompt.invalid_macro.dot_unsupported",
  "error.prompt.invalid_macro.unknown",
  "error.prompt.invalid_macro.persist_forbidden",
  "error.prompt.macro_expand_failed",
  // provider
  "error.provider.display_name_required",
  "error.provider.saved_model_in_use",
  // session_fs：回滚 / 恢复（restore 三处复用 restore_revision_missing）
  "error.session_fs.rollback_message_not_found",
  "error.session_fs.rollback_message_session_mismatch",
  "error.session_fs.restore_revision_missing",
  "error.session_fs.rollback_undo_send_empty_target.rewind",
  "error.session_fs.rollback_undo_send_empty_target.undo_send",
  "error.session_fs.rollback_revision_backfill_required",
  "error.session_fs.rollback_conflict",
  "error.session_fs.rollback_tail_drift",
  "error.session_fs.vfs_restore_failed",
  "error.session_fs.invalid_rollback_options",
  // skill：域参数 / 名称 / 路径 / front matter（reason 入子段）
  "error.skill.missing_domain",
  "error.skill.missing_project_id",
  "error.skill.not_found_in_domain",
  "error.skill.not_found_in_domain_hint.create",
  "error.skill.not_found_in_domain_hint.other_domain",
  "error.skill.not_found_in_domain_hint.neither_domain",
  "error.skill.not_found_in_domain_hint.probe_failed",
  "error.skill.builtin_not_deletable",
  "error.skill.builtin_name_reserved",
  "error.skill.builtin_rename_forbidden",
  "error.skill.already_exists",
  "error.skill.invalid_name.empty",
  "error.skill.invalid_name.skill_md_reserved",
  "error.skill.invalid_name.leading_dot",
  "error.skill.invalid_name.whitespace",
  "error.skill.invalid_name.slash",
  "error.skill.invalid_name.unsupported_chars",
  "error.skill.invalid_path.empty",
  "error.skill.invalid_path.dotdot",
  "error.skill.invalid_path.escape",
  "error.skill.entry_file_missing",
  "error.skill.front_matter_missing",
  "error.skill.front_matter_unparsable",
  "error.skill.front_matter_field_invalid",
  // smart_sort_rule
  "error.smart_sort_rule.import_yaml_invalid",
  // tool：搜索配置
  "error.tool.search_not_configured",
  "error.tool.search_api_key_required",
  "error.tool.search_searxng_base_url_invalid",
  "error.tool.search_engine_order_invalid",
  // usage：统计入参校验
  "error.usage.invalid_day_format",
  "error.usage.invalid_day",
  "error.usage.daily_buckets_range_required",
  "error.usage.invalid_page_limit",
  "error.usage.invalid_page_offset",
  "error.usage.session_id_required",
  "error.usage.from_after_to",
  // vfs：用户文案表 / 名称校验 / 角色卡 / zip / 批量导入（VFS_* 归并 vfs 域）
  "error.vfs.not_found",
  "error.vfs.replace_not_found",
  "error.vfs.already_exists",
  "error.vfs.operation_failed",
  "error.vfs.invalid_name.dotdot",
  "error.vfs.invalid_name.blank",
  "error.vfs.invalid_name.control_chars",
  "error.vfs.invalid_name.edge_spaces",
  "error.vfs.template_prefix_forbidden",
  "error.vfs.zip_root_prefix_suspected",
  "error.vfs.character_card_unrecognized",
  "error.vfs.character_card_unsupported_spec",
  "error.vfs.character_card_too_large.single_file",
  "error.vfs.character_card_too_large.total_content",
  "error.vfs.character_card_too_large.file_count",
  "error.vfs.character_card_too_large.input",
  "error.vfs.character_card_import_failed.with_progress",
  "error.vfs.zip_import_failed.with_progress",
  "error.vfs.batch_ingest_partial",
] as const;

/** 展示标签 key（B 桶 68 处去重后的全量清单）。 */
const LABEL_MESSAGE_KEYS = [
  // agent：存储配置失效面板 + Agent 列表 + customAttach 块标签
  "label.agent.invalid_title",
  "label.agent.reason_outdated_version",
  "label.agent.reason_removed_feature",
  "label.agent.reason_broken_wire",
  "label.agent.action_restore_and_save",
  "label.agent.action_clear_and_save",
  "label.agent.action_delete",
  "label.agent.action_overwrite_default",
  "label.agent.action_back",
  "label.agent.needs_repair",
  "label.agent.max_steps",
  "label.agent.config_invalid",
  "label.agent.custom_attach",
  // attachment：状态 chip 动作二字 + chip 模板
  "label.attachment.action.delete",
  "label.attachment.action.write",
  "label.attachment.action.edit",
  "label.attachment.action.mkdir",
  "label.attachment.action.rename",
  "label.attachment.action.move",
  "label.attachment.action.workplace_change",
  "label.attachment.action.annotate",
  "label.attachment.chip",
  // chat
  "label.chat.link_not_found",
  // prompt_preview：summaryText / metaText / 预览截断
  "label.prompt_preview.tool_calls_chars",
  "label.prompt_preview.segment_fallback",
  "label.prompt_preview.empty_text",
  "label.prompt_preview.segments",
  "label.prompt_preview.tool_calls",
  "label.prompt_preview.chars",
  "label.prompt_preview.failed",
  "label.prompt_preview.lost",
  "label.prompt_preview.attachments",
  "label.prompt_preview.truncated_text",
  "label.prompt_preview.more_items",
  "label.prompt_preview.more_fields",
  // provider：模型设置选项表
  "label.provider.thinking_level.off",
  "label.provider.thinking_level.low",
  "label.provider.thinking_level.medium",
  "label.provider.thinking_level.high",
  "label.provider.token_counter.auto",
  "label.provider.token_counter.tiktoken",
  "label.provider.token_counter.claude",
  "label.provider.token_counter.gemma",
  "label.provider.token_counter.llama3",
  "label.provider.token_counter.mistral",
  // smart_sort：排序元组哨兵显示
  "label.smart_sort.pinned_min",
  "label.smart_sort.pinned_max",
  // stream_metrics：指标条 4 key（速率段独立 key，不用空串拼）
  "label.stream_metrics.running",
  "label.stream_metrics.last",
  "label.stream_metrics.line",
  "label.stream_metrics.line_with_rate",
  // token_source
  "label.token_source.api",
  // workplace：UI 四态标签（filetree 宏标签保持 string，不在此列）
  "label.workplace.rule_on",
  "label.workplace.rule_off",
  "label.workplace.inclusion.auto",
  "label.workplace.inclusion.show",
  "label.workplace.inclusion.hide",
  "label.workplace.display.hidden",
  "label.workplace.display.full",
  "label.workplace.display.header",
  "label.workplace.display.filename",
] as const;

/** core 全量消息 key（zh-CN catalog 必须 100% 覆盖）。 */
export const CORE_MESSAGE_KEYS = [...ERROR_MESSAGE_KEYS, ...LABEL_MESSAGE_KEYS] as const;

export type CoreMessageKey = (typeof CORE_MESSAGE_KEYS)[number];

/** core 消息 descriptor：随错误/IPC 流动的可序列化文案描述。 */
export type CoreMessageDescriptor = MessageDescriptor<CoreMessageKey>;
