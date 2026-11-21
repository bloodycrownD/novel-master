# p27 R6 波 3c-b 片 M：mobile 源码契约测试正则对齐 + 锁定处补迁（2026-11-21）

## 做了什么

波 3-2 迁移时被 readFileSync+正则契约测试锁死的 26+ 处（M3 23 + M2 5）按四步收口：测试断言先对齐 `coreT({key})` descriptor 形态（断言意图不变——锁「这段 UI 用的确是这些键」，不是锁中文本身），再把源码回退处恢复成迁移前的 coreT 形态。5 个 commit 按测试文件分片。

- provider-detail-tabs（680f58b51）：两 tab 断言改锁 `\{value: 'config', label: coreT\(\{key: "ui\.nav\.providers"\}\)\}` 等；ProviderDetailScreen 两 tab 补迁（ui.nav.providers / ui.nav.model_management）
- skill-info-edit-modal-contract（a2a9dd2dd）：modalSrc 三元改锁 `builtin ? coreT({builtin_hint}) : coreT({plain})`、manageSrc 改锁 `label: coreT({edit_info})`、newSkillSrc 改锁 dir_hint 键名；SkillInfoEditModal/NewSkillModal/SkillsSettingsScreen 四处补迁
- vfs-character-card-menu（a70615e7c + 0c961b7e6 注释清理）：T-MM1/4/5/2 全部断言改锁 coreT 调用形态+键名+占位实参（如 `coreT({key: "ui.vfs.import_overwrite_confirm", params: {target: importTargetLabel(path)}})`）；VfsFileManager 全部回退处恢复迁移前形态（含 singleFileImportToast 三元——它在 1210c1075 里也被回退了但台账 12 处没单列，实迁 14 行）
- storage-config-screen-source（9eac2a70e）：五个顺序锚点 indexOf 改锚 `title={coreT({key: "ui.storage.space_section"})}` 等带引号调用形态（老锚点 `title="存储空间"` 引号形式定位失效，`title={coreT(...)}` 同样算破坏锚点）；StorageConfigScreen 全部回退处补迁

## 关键经验

1. **对齐正则时的引号策略**：源码里 coreT 调用含双引号键名，测试断言用模板串（反引号）包最省心；toMatch 正则里 `{`/`(`/`"` 需转义、键名 `.` 需转义。
2. **顺序锚点搬家**：indexOf 锚点从 `'label="云端配置"'` 换成 `'label={coreT({key: "ui.storage.cloud_entry"})}'` 后，cleanup_section 在文件里出现两次（label 与 Alert.alert），锚点串带 `label={` 前缀保证 indexOf 命中靠前的那处。
3. **回退标记注释要随迁删**：1210c1075 的回退处带「波 3c 对齐后再迁」注释，补迁时只换了代码行会漏注释（vfs 分片实测漏 3 条，归零自检抓回，0c961b7e6 补删）。
4. **台账处数 ≠ 实迁行数**：M3「12 处」是逻辑位（成功 toast 三元算 1 处），按 1210c1075 的 diff 全量恢复即可，别按数字硬凑。
5. 键全部在键面（keys.ts + zh-CN.yaml 反查核实：ui.nav.providers / ui.nav.model_management / ui.skills.name_label_plain|builtin_hint|dir_hint / ui.skills.edit_info / ui.vfs.import_* / ui.storage.* / ui.cloud_sync.configured|not_configured / ui.common.cleanup_failed|zip_saved），零自立键。

## 归零自检（引号无关 grep 中文，去注释行）

全部残留对上既有 MISS 台账，零意外：

- VfsFileManager:428 `选中项含受保护路径：${blocked[0]}`（3-2d 台账 MISS，键面无键）
- ProviderDetailScreen:209 `title="已保存模型"`（M2 台账 MISS；provider-detail-tabs.test:42 对它的断言不在本波范围，保持锁中文）
- NewSkillModal:104/105/132/163 校验四句（M2 台账 MISS）
- SkillsSettingsScreen:121 加载技能失败、:167 删除确认 frame 尾句（M2 台账 MISS）

## 验证

- 四个测试文件单跑：8/8、6/6、5/5、9/9 全绿；vfs 相关 14 套件 94 测试、storage 相关 3 套件 19 测试无连带红
- mobile typecheck 三段（tsconfig.build / src/web / e2e）每 commit 前跑，全绿
- 全量 npm test：268 suites 2384/2384 全绿，与基线一致，零新增红
