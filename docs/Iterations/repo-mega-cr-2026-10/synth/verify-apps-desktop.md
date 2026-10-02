# W6 验证报告 · apps/desktop（skill-ui / AgentEditorView 切片）

> **输入缺失声明（必读）**：`synth/apps-desktop.md` 在本代理开跑时**不存在**
> （`D:\Dev\nm-worktree\mcr\synth\` 为空目录）。因此本报告**不是**对既有 P1 逐条
> 打勾，而是**从代码零起重新推导** apps/desktop 侧的 P1 候选并逐条自证/自驳。
> 若协调方手上有原 P1 清单，请对照下表 `ID` 列（`A~E` 为本次新推导，`R*` 为已核验
> 驳回的疑似项）。

工作树：`D:\Dev\nm-worktree\mcr`（分支未动，全程只读；未执行任何 git 写操作）

---

## 一、免验清单（沿用主代理已核结论）

| 项 | 免验依据 |
|---|---|
| X1 门禁类 | 主代理已实跑 eslint，结论直接采信，不重复执行 |
| 单例陈旧句柄 | 主代理已核四点（持有者/重置时机/跨窗口/异步交错），本代理不再复算 |

---

## 二、P1 verdict 表（自推导 · 逐条从代码重新推导）

| ID | 位置 | 断言 | 重新推导 | verdict |
|---|---|---|---|---|
| **A** | `renderer/features/settings/AgentEditorView.tsx`（全文无 `dirtyViews`）+ `layout/SettingsOverlay.tsx:135-155,236-247,268-272,291-300` + `features/settings/settings-nav.ts:99,158-175` | agentEditor 从不向 `nav.dirtyViews` 上报 dirty，导致「返回 / 关闭 / 侧导航」三条分发点全部不弹「未保存的更改」，Agent 编辑器内改动静默丢弃 | `SettingsOverlay` 的守卫 `shouldGuardSettingsNav` 读 `dirtyViews.has(currentViewId)`；全仓 `renderer/` 内 `dirtyViews.add` 只出现在 `SkillDetailView.tsx:142,144,147` 一处。`agentEditor` 永不入集合 → 守卫恒 false。`AgentEditorView` 里的 `dirty` 只用于 `desc` 文案「· 未保存」（:630,:687），不接任何离开通道。`nav.push`/`nav.pop` 按设计不过守卫（:131-133），故 `SettingsViews.tsx:717` 的「进编辑器」不构成补偿 | **confirmed · P1** |
| **B** | `packages/core/src/config-forms/agent/agent-editor-state.ts:542-569`（`formSnapshotJson`）+ `AgentEditorView.tsx:169-217,630` | 作用域 `mode` 不进 dirty 快照，改「作用域」下拉后 `dirty` 恒 false，既不显示「· 未保存」，离开即丢 | `formSnapshotJson` 序列化字段逐条核对：`name/maxSteps/modelEnabled/toolsMode/toolsSelected/[providerId+savedModelId]/systemEnabled/systemContent/persistEnabled/dynamicEnabled/workplaceEnabled/workplaceAssistantText/customAttach*/skillsEnabled/skillsPrefixText/description/persist/dynamic` —— **无 `mode`**。而 `mode` 是真落库字段（`buildAgentDefinitionFromForm:614` `mode: input.mode`），UI 也渲染了 `MODE_OPTIONS` 下拉（`AgentEditorView:744-756`）。旁证：`customAttach`（T-CA2c）与 `description`（T-DESC5）各有一条「纳入 dirty 比对」的回归测试（`packages/core/test/config-forms/agent-editor-state.test.ts:451,1205`），唯独 `mode` 无对应测试 → 属遗漏而非有意排除 | **confirmed · P1** |
| **C** | `renderer/features/skills/skill-ui.ts:21-35`（`buildNewSkillDoc`）+ `renderer/features/skills/NewSkillModal.tsx:256-262,199` | 新建技能模板手搓 YAML 字符串插值，绕过 core 的 front matter 单源 `withSkillFrontMatterValues`，多行 / 含冒号 / 含 `#` 的描述会写出坏 front matter，技能建完即 `valid:false` 并被踢出技能索引 | `buildNewSkillDoc` 直接 `name: ${name}` / `description: ${description}` 裸插。描述输入是 `<textarea rows={3}>`（`NewSkillModal:256-262`），**不限行、不滤换行**。core 单源 `with-skill-front-matter-values.ts:26-28,52` 明确用 `JSON.stringify` 写双引号标量，注释原话「含冒号 / 引号 / 换行的描述不会破坏解析」——`skill-ui.ts:37-38` 自己的注释也承认重写已回收 core 单源，唯独模板这一条没跟上。失败链路已验：`parseSkillFrontMatter`（`:49-60`）YAML 解析抛错 → `valid:false` + `invalidReason` → `skills.service.ts:289-299` `summarizeSkill` 标无效 → `computeEffectiveSkills` 剔除。名字侧同理：`SKILL_NAME_PATTERN` 只禁空白与 `/`、不拦 `:`（`domain/skills/model/skill-name.ts:17`），技能名 `a:b` 同样写坏 | **confirmed · P1** |
| **D** | `AgentEditorView.tsx:582-602`（`deletePersist` vs `deleteDynamic`） | 两条删除守卫用了**两个不同**的计数器，导致 UI 放行的删除在 `save()` 时必然失败（软锁） | `deletePersist:589` 用 `countFormPromptSources`，`deleteDynamic:598-601` 用 `countEffectiveFormPromptSources`。后者与保存门 `hasEffectivePromptSource`（= `countEffectiveFormPromptSources > 0`，`agent-editor-state.ts:329-343`）**同口径**；前者不同口径：它按块数累加且**不看 `persistEnabled`/`dynamicEnabled` 开关**（`:394-424`）。可达路径：系统区开但内容留空 + 动态区留有块但已关（文案「关闭后内容仍保留」，`PROMPT_REGION_LABELS.dynamicDisabledHint`）+ 持久区仅一块 → 删该块时 `countForm` = 0+0+0+1(dynamic 残留) = 1 放行；保存时 `hasAnyPromptRegionEnabled`（systemEnabled）true 而 `hasEffectivePromptSource` = 0 → 返回 `ok:false`「至少保留一个 Prompt 块」 | **adjusted · P1→P2**：缺陷成立（计数器选错，必被保存门反打），但用户可重新「添加」一个块自救，是软锁不是数据丢失；且需凑齐三态才触发。修复成本一行（`:589` 换 `countEffectiveFormPromptSources`） |
| **E** | `AgentEditorView.tsx:221-251,308-360,488-537` | 「专属模型」pin 在 `providers` / `savedModels` 拉取失败时**静默丢失**：pin 被当成「未选中」，下一次保存把 `definition.model` 删掉 | `loadAllSavedModels:242` 对单个服务商失败 `res.ok ? … : []` **吞错**；`loadAgent:337-342` 对 `ipcProvidersList()` 失败同样降级成 `[]` 且不提示。任一失败 → `savedModels` 缺该模型 → `:347-350` `allModels.find(m => m.id === def.model)` 得 `undefined` → `applyDefinition(def, null)` → `modelEnabled=false`（`:286-289`）。基线同源故 `dirty=false`，用户毫无察觉；随后任意一次 `save()` 走 `:517-521` `delete definition.model` → pin 被抹。**无任何缓解**：无错误横幅、无「原绑定模型不可用」提示、无二次确认 | **confirmed · P1**（数据静默丢失） |

---

## 三、已核验驳回 / 已缓解项（防重复报）

| ID | 疑似 | 结论与依据 |
|---|---|---|
| R1 | `SKILL_NAME_PATTERN` 带 `g` 标志导致 `.test` 有状态、`isValidSkillNameInput` 隔次飘 | **refuted**：`skill-name.ts:20-22` `new RegExp(...)` 无任何 flag；`^[^\s/.][^\s/]*$` 锚定，`lastIndex` 无从推进 |
| R2 | 用户自建 agent 的 id 撞上内置 `general` sentinel（`AgentEditorView:94,115,318`），编辑页被误判只读 | **refuted**：`handleAgentRegistryCreateBlank` 的 id 恒为 `` `agent-${Date.now()}` ``（`agent-registry.ts:169`）；`general` 只是 `SettingsViews.tsx:679-680,919` 在渲染层合成的虚拟行，不入库。服务端的 `upsert/delete` 拒绝同名（`agent-registry.service.ts:108,157`）也只按 **name** 判，与按 **id** 判的 sentinel 正交，无冲突 |
| R3 | `loadAgent` 无 abort / 无世代号，并发切换 agent 会让旧响应覆盖新表单 | **refuted**：`editingAgentId` 全仓仅 `SettingsViews.tsx:717` 一处写入，且紧跟 `:720 nav.push("agentEditor")` 使 `viewId` 变化 → `SettingsOverlay:312 <div key={viewId}>` 同步重挂载。`agentEditor` 视图存活期内 `agentId` 恒定，竞态不可达 |
| R4 | `persist.filter(type==="text")` 得到的 index 与 `mapPersistTextBlocks` / `movePersistTextBlock` / `deletePersistTextBlock` 的入参 index 不同源，会改错块 | **refuted**：三者内部都先过 `splitPersistBlocksForEditor` → `persistTextBlocksFromEditor`（`agent-editor-state.ts:206-247`），只对 `type==="text"` 子集按序取 index，与 UI 侧 `filter` 后的下标同源；且 `EditorPersistPromptBlock` 现网无第二个 type 变体 |
| R5 | `applyDefinition` 里 `...promptForm` 展开会覆盖显式写的 `name/maxSteps/model*/tools*` 基线字段，导致一进页面就误报 dirty | **refuted**：`definitionToForm` 返回类型（`:449-467`）与实现（`:475-490`）都不含这 7 个 key，展开不产生覆盖；基线与 `snapshot` 的 key 集完全一致 |
| R6 | `isValidSkillNameInput`（`skill-ui.ts:41-43`）漏判保留名 `SKILL.md`，注释 `:40` 却自称「非保留名」 | **已缓解 · P3（仅注释与实现不符）**：手进通道最终走 `ipcSkillsWrite`，服务端 `skills.service.ts:117` 的 `validateSkillName` 会拒并把原因回传 UI；ZIP 导入通道另有 `ipcSkillsAssertCreateName` 预检（`NewSkillModal:150-158`）。两侧都不会建出坏技能。属注释失真，非功能缺陷 |

---

## 四、附带观察（非 P1，供参考）

- `AgentEditorView:493-495` 调 `buildAgentDefinitionFromForm` 时把 `modelEnabled/savedModelId` 硬写 `false`，绕过 core 的 `isSavedModelUuidFormat` 校验（`agent-editor-state.ts:603-609`），改由 `:517-521` 手工赋值。当前下拉只喂真 UUID，不构成缺陷，但两处 model 处理分家，后续改动易踩。
- `AgentEditorView:1301-1326` 宏芯片插入读的是**陈旧** `dynamicInsertIndex`：焦点在别的块时 `ta` 取到 `null`，插入位置退化为「追加到文末」而非光标处；`setDynamicInsertIndex` 是异步的，同一 tick 内读不到新值。
- `E` 的最小修法建议：加载失败时不要把 pin 折叠成 `false`，而是保留 `def.model` 原值 + 渲染一条「原绑定模型当前不可用，保存将解除绑定」的提示。
