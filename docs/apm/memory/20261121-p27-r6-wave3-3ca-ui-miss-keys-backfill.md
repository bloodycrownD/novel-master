# p27 R6 波 3c-a 片：ui 补键收尾（波 3-2 六片 MISS 立键，2026-11-21）

分支 p27-backlog。波 3-2 六片（M1/D1/M2/D2/M3/D3）交卷后汇总 MISS 清单立键：**68 个新键 + 15 组复用裁决**，只碰注册面四文件（keys.ts / zh-CN.yaml / en-US.yaml / generated-catalog.ts），组件零改动。ui 域键数 1127 → 1195；生成器重跑后 zh-CN 1454 键、en-US 1270 键。

## 形态

- 新键按 `ui.<screen>.<element>` 归属既有 23 域（UI_KEY_DOMAINS 未扩域），keys.ts 各域段末尾追加「波 3c-a 补键」子段，逐域分组注释保持；zh/en catalog 同位置镜像插入（en 直译占位，G6 复核），占位一律 `{snake_case}`。
- en 镜像契约：ui 域 zh 有键 en 必有（catalog.test 断言），{param} 集合两侧一致。

## 新键对号表（键 → 来源片与组件 → 处数；补迁片照此接线）

### common（4）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.common.compact_failed | 压缩失败 | M1 useChatTabMessageActions 125/128/149 + SessionDetailScreen 164×2/191 | 7 |
| ui.common.fork_failed | 分叉失败 | M1 useChatTabMessageActions 171/176/185 | 3 |
| ui.common.disable | 禁用 | M2 SmartSortRulesScreen:287 + D3 SettingsViews:2036 | 2 |
| ui.common.unsaved_changes | 有未保存的更改 | M2 AgentEditorForm:288「有未保存的更改」+ SmartSortRuleEditorScreen:344「未保存的更改」+ D2 SkillDetailView:396 title | 3（两措辞合一） |

### session（4）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.session.agent_unconfigured | 未配置 Agent | M1 chat-agent-meta.ts:87/131 none 态兜底名（mobile 独有） | 2 |
| ui.session.compact_button | 压缩 | M1 useChatTabMessageActions ~L110 + SessionDetailScreen ~L155 Alert 确认按钮 | 2 |
| ui.session.view_skills_aria | 查看会话技能 | D1 SessionDetailDrawer:404 | 1 |
| ui.session.switch_model_locked_aria | 切换大模型（已锁定） | D1 SessionDetailDrawer:494 锁定分支 aria | 1 |

### agent（5）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.agent.agent_id_missing | 缺少 agentId | D2 AgentEditorView:446（对称 ui.provider.provider_id_missing） | 1 |
| ui.agent.load_failed | 无法加载智能体配置 | D2 AgentEditorView:525 | 1 |
| ui.agent.not_found | 未找到 Agent：{agent_id} | M2 useAgentEditorFormState:281 | 1 |
| ui.agent.new_title | 新建 Agent | D3 SettingsViews:970 | 1 |
| ui.agent.deleted_count_done | 已删除 {count} 个 Agent | D3 SettingsViews:890 count>1 分支 | 1 |

### provider（14）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.provider.connect_section | 连接 | M2 ProviderForm:191 FormSectionCard | 1 |
| ui.provider.change_required | 请至少修改一项 | M2 ProviderForm:135（throw 沿 handleSave catch 走 toast，用户可见，非 dev throw） | 1 |
| ui.provider.models_saved_done | 已保存模型 | M2 ProviderDetailScreen:209 + D3 SettingsViews:1636（两端同 ManageHeader title） | 2 |
| ui.provider.config_invalid_copy_blocked | 配置已失效，请先修复后再复制 | D3 SettingsViews:838 | 1 |
| ui.provider.config_invalid_rename_blocked | 配置已失效，请先修复后再重命名 | D3 SettingsViews:907 | 1 |
| ui.provider.name_required | 请填写服务商名称 | D3 SettingsViews:1357 | 1 |
| ui.provider.name_empty | 服务商名称不能为空 | D3 SettingsViews:1179/1383 | 2 |
| ui.provider.new_title | 新建服务商 | D3 SettingsViews:1217/1414 + SettingsOverlay:187 | 3 |
| ui.provider.rename_title | 重命名服务商 | D3 SettingsViews:1267 | 1 |
| ui.provider.api_key_label | API Key | D3 SettingsViews:1458 create 分支 | 1 |
| ui.provider.api_key_new_label | 新 API Key | D3 SettingsViews:1458 edit 分支 | 1 |
| ui.provider.secret_key_label | Secret Access Key | D3 SettingsViews:535/536 | 2 |
| ui.provider.path_style_label | Path style（MinIO / 部分 OSS） | D3 SettingsViews:554 | 1 |
| ui.provider.api_key_sksp_hint | API Key 将通过 SKSP 安全存储 | D3 SettingsViews:1422 | 1 |

edit 模式的「（留空则不修改）」括注补迁时用既有 ui.provider.api_key_keep_hint 拼（composed 口径），不另立整句键。

### sampling（2）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.sampling.saved_done | 已保存模型设置 | M2 ModelSamplingScreen:147 + D2 ModelSamplingView:168 | 2 |
| ui.sampling.reset_done | 已恢复默认采样参数 | M2 ModelSamplingScreen:168 + D2 ModelSamplingView:196 | 2 |

### chat_config（1）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.chat_config.title | 聊天配置 | M1 header-config:30 + ProfileTabScreen:48 | 2 |

### skills（8）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.skills.load_failed | 加载技能失败 | M2 SkillPanelScreen:76 + SkillDetailScreen:57 + SkillsSettingsScreen:121 | 3 |
| ui.skills.aux_deleted | 已删除辅助文件 | D1/D2 SkillDetailView:239 | 1 |
| ui.skills.path_relative_label | 相对路径（支持子目录，如 references/x.md） | D2 SkillDetailView:371 | 1 |
| ui.skills.desc_empty | 描述不能为空（进入索引，供模型判断是否使用） | M2 NewSkillModal:104 | 1 |
| ui.skills.project_required | 请选择所属项目 | M2 NewSkillModal:105 | 1 |
| ui.skills.zip_root_missing | ZIP 根目录缺少 SKILL.md（导出格式：zip 根即技能目录） | M2 NewSkillModal:132 | 1 |
| ui.skills.domain_name_conflict | 目标域已存在同名技能「{name}」 | M2 NewSkillModal:163 | 1 |
| ui.skills.delete_confirm_frame | 。确定删除{names}？删除会清理整目录与对应禁用记录。 | M2 SkillsSettingsScreen:167（M2 报的 frame+尾句两段合一个 {names} 模板；{names} 实参取 selected_skills_label(count) 或「names」字面，scopeHint 沿既有 scope_hint_* 键前拼） | 1 |

### smart_sort（7）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.smart_sort.saved_done | 已保存规则 | M2 SmartSortRuleEditorScreen:311 | 1 |
| ui.smart_sort.enable_label | 启用规则 | M2 :350 FormSwitchRow + D3 SettingsViews:2538 | 2 |
| ui.smart_sort.regex_invalid | 正则无效：{detail} | M2 :449 + D3 SettingsViews:2494/2595 | 3 |
| ui.smart_sort.test_text_required | 请输入测试文本 | D3 SettingsViews:2377 | 1 |
| ui.smart_sort.reset_title | 恢复默认规则 | D3 SettingsViews:2260 ConfirmModal title | 1 |
| ui.smart_sort.help_smart_title / help_smart_body | 智能数字 / 从正则捕获组提取序号… | M2 SmartSortRuleEditorScreen:484（接 help_priority/help_fixed/help_regex 家族） | 1+1 |

### prompt（1）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.prompt.select_project_session | 请先选择项目与会话 | M2 RealPromptScreen:88 | 1 |

### stats（6）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.stats.session_total | 会话累计 | D1 MetricsDetailPopover:193 + M3 MetricDetailSheet:104 | 2 |
| ui.stats.range_required | 请选择起止日期 | D3 TokenUsageStatsView:396/399 | 2 |
| ui.stats.usage_label | 用量 | M3 PieChart:194 | 1 |
| ui.stats.ratio_label | 占比 | M3 PieChart:196 | 1 |
| ui.stats.day_hourly_template | {day} · 按小时分布 | D3 TokenUsageStatsView:995（day_hourly_title 是「今天 · 」固定前缀，带日参数另立模板键） | 1 |
| ui.stats.format_invalid | 统计数据返回格式异常 | D3 TokenUsageStatsView:461/523 | 2 |

### cloud_sync（6）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.cloud_sync.push_action | 推送 | M3 TemplatePushButton:63 + M2 同串 | 2 |
| ui.cloud_sync.minio_optional_hint | MinIO 可留空 | M3 CloudSyncConfigScreen:179 | 1 |
| ui.cloud_sync.region_label | Region | M3 CloudSyncConfigScreen:179 | 1 |
| ui.cloud_sync.pull_confirm_title | 确认拉取 | D3 SettingsViews:725 | 1 |
| ui.cloud_sync.pull_confirm_msg_desktop | 拉取将用云端快照替换本机数据库…确定继续？ | D3 SettingsViews:726（mobile pull_confirm_msg 不同文，桌面变体另立） | 1 |
| ui.cloud_sync.cloud_newer_msg_desktop | 云端有尚未拉取的更新…（将丢失云端未拉取的变更）。 | D3 SettingsViews:735（桌面文案多数据丢失警示，语义增量为真不同，立 _desktop 变体；title 见复用 R8） | 1 |

### vfs（9）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.vfs.protected_path_blocked | 选中项含受保护路径：{path} | M3 VfsFileManager:428 | 1 |
| ui.vfs.invalid_action | 无效操作 | D3 workspace-actions:57/95/113（unknown_action 是「未知操作」，语义不同文） | 3 |
| ui.vfs.pick_file_failed | 选择文件失败 | D3 workspace-actions:230 | 1 |
| ui.vfs.drag_out_failed | 拖出失败 | D3 workspace-batch-dnd:92/229 | 2 |
| ui.vfs.export_materialize_failed | 导出物化失败 | D3 workspace-batch-dnd:180/194 | 2 |
| ui.vfs.import_hint_zip / import_hint_card / import_hint_file | 解压到目标目录…/解析角色卡…/写入单个文件… | D3 ImportFormModal:33/38/43 | 1+1+1 |
| ui.vfs.annotate_actions_aria | 批注操作 | D3 PreviewAnnotateUi:29 | 1 |

### about（1）
| 键 | zh | 来源 | 处数 |
|---|---|---|---|
| ui.about.title | 关于 | D1 settings-nav.ts:52/58（ui.nav.about 是「关于 Novel Master」整句） | 2 |

## 复用裁决（15 组，组件补迁时改用现键，中文以 zh catalog 逐字为准——收口去漂移）

| 组件原串（片:位置） | 统一到现键（catalog 文案） |
|---|---|
| 推送成功（M3 CloudSyncProgressScreen:179） | ui.cloud_sync.push_done「推送完成」 |
| 已重命名会话（D1 SessionDetailDrawer:313） | ui.common.renamed「已重命名」 |
| 缺少模型（D2 ModelSamplingView:119） | ui.sampling.model_missing「模型不存在」 |
| 已更新模型名称（D2 ModelSamplingView:141 + D3 SettingsViews:1569） | ui.provider.model_renamed_done「已重命名模型」 |
| 开始日期不能晚于结束日期（D3 TokenUsageStatsView:400） | ui.stats.range_start_after_end「自定义区间起始日不能晚于结束日」 |
| 暂无主/子智能体，点击上方按钮创建。（D3 SettingsViews:979/980） | ui.agent.list_primary_empty / list_subagent_empty「…点击「新建」创建。」 |
| 云端较新（D3 SettingsViews:734 弹窗 title） | ui.cloud_sync.cloud_newer_title「云端有更新」 |
| (空匹配)半角（D3 SettingsViews:2586） | ui.smart_sort.no_match_text「（空匹配）」全角 |
| 请先填写正则表达式（M2:266 + D3:2382） | ui.smart_sort.regex_required「请填写正则表达式」 |
| 新建规则（D3 SettingsViews:2075） | ui.smart_sort.new_rule_title「新规则」 |
| 认证 section（M2 ProviderForm:203） | ui.provider.auth_section「认证」 |
| API Key 状态：（D3 SettingsViews:1418） | ui.provider.api_key_status_prefix（同文含冒号） |
| 智能体作用域 aria（D3 SettingsViews:927） | ui.agent.scope「作用域」 |
| 清理按钮（D3 SettingsViews:703） | ui.storage.cleanup_action「清理数据库空间」 |
| 「未保存的更改」「有未保存的更改」措辞归一（见 common.unsaved_changes，算半新键半裁决） | ui.common.unsaved_changes「有未保存的更改」 |

## 不立清单（口径排除，非键面欠账）

- M1 重建 runtime 超时/已取消（novel-master-context Error 构造，基建错误形态）。
- D3 `segment index 越界`（vfs-tree-utils RangeError 基建 throw）。
- M2 ProviderForm BOUNDARY dev throw ×3（Headers/Header/自定义参数 JSON，已登记）。
- 全部契约测试锁定回退处（D1 13 处 / D2 5 处 / M2 5 处 / M3 23 处 / D3 db-maintenance+agents-tabs+smart-sort 锁面）——待波 3c-b/c 对齐测试后迁（3c-b mobile 已开跑，其归零自检与本对号表吻合）。
- D1 nav-workspace.ts 6 处、D2 AgentWorkplaceBlockCard:56（清单外发现，待补迁片）。
- M2 useUnsavedGuard 默认参「有未保存的更改，确定离开？」与 ui.common.unsaved_confirm_msg 同文未报——补迁时可顺手接。
- M3 MermaidViewerOverlay closeLabel 缺省＝接线设计回退，非漏迁。
- 对号表外借键裁决（D2 skillsTag→ui.nav.skills、D3 settings_smart_sort/label.filename/slice_aria/chart_calls_aria）属补迁复核口径，本片不动。

## 验证

- i18n 专项（test/i18n 经 run-tests harness）：19/19 绿。
- core typecheck：绿。test:core:fast：455 文件 3543 用例 687/687 全绿（与基线一致）。
- desktop typecheck：主 tsconfig 绿；renderer 294 条与分支既有基线逐条同数（test 文件与未触碰组件的存量欠账），零新增。
- mobile typecheck 三段（tsconfig.build / src/web / e2e:tsc）：全绿。
- nm-style check keys.ts：PASS（signatures=0 hygiene=0；dup +3/-1 经 gate dup 复核 exit 0，+3 组全在并行线 mobile 文件，与本片无关）；gate dup PASS。
- git status 仅四注册面文件，无组件/测试文件混入。

## commit

`feat(i18n): p27 R6 波 3c-a ui 补键收尾`——git add 精确四文件 + 本记忆文件。
