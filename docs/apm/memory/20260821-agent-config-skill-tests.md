# agent-config 内置技能迭代 Step 4：正式测试落盘（impl-ac-tests）

- 日期：2026-08-21；主仓 `novel-master`，分支 `feat/pms-integration`。前序：bd56cd9（seed）/ e209bbd（拦截）/ af0d86d（description 瘦身）。
- 改动：
  - 新增 `packages/core/test/bootstrap/seed-builtin-skills.test.ts`（T-AS1）：全新内存库 bootstrap 后 listSkills 含 agent-config 且 valid、内容 === AGENT_CONFIG_SKILL_MD；用户 editSkillFile 改过正文后重跑 seedBuiltinSkills 不覆盖（幂等跳过）。
  - `packages/core/test/skills/skills.service.test.ts` 追加三例：T-AS2 global 内置名删除抛 BUILTIN_SKILL（中文 message 匹配）且目录仍在 + project 域历史同名副本（VFS 直写模拟存量）可正常删；T-AS6 目录已存在编辑放行（writeSkillFile 写辅助文件 + editSkillFile 改本体）/ project 新建拒 / global 模拟 seed 缺失（hardDelete 目录递归）新建拒。
  - spec 测试策略小幅对齐：T-AS3 补 ≤380 字符口径与被删段落不残留断言；T-AS4/T-AS6 注明 writeSkillFile 整文件覆盖受 VFS 乐观锁约束的边界。
- 关键发现：`openNovelMasterTestConnection` 跑的 bootstrapNovelMaster 已挂 seedBuiltinSkills，共享测试库的 global agent-config 天然存在，直接当"已 seed"态用。
- 踩坑：`vfs.write` 对已存在文件默认开 versionCheck，`writeSkillFile` 不透传 expectedVersion → 对已存在 SKILL.md 的整文件覆盖必撞 CONFLICT（"expectedVersion required"）。测试里编辑内置本体要走 editSkillFile（replace 语义无版本墙），writeSkillFile 的放行路径用写辅助文件（notes.md）覆盖。UI 若走 writeSkillFile 编辑已存在技能也会撞此墙——待核实 UI 实际保存路径。
- 验证：seed + skills.service 16/16；回归 7 文件（skills 系 5 + agent-tool + seed）56/56 全绿；core typecheck 过。

## 追记：UI 保存撞乐观锁 bug 修复 + 功能小检（cr-func）

- 日期：2026-08-21；fix 提交 edadb49（上节“待核实”的落实）。
- 根因坐实：SkillDetailView.save → ipcSkillsWrite → writeSkillFile → vfs.write 从不透传 expectedVersion，编辑任何已存在技能文件必撞 CONFLICT；NewSkillModal ZIP 导入后重写 SKILL.md front matter 同款（zip import 先落盘，重写目标已存在）。
- fix 内容：core SkillWriteOptions 加 expectedVersion 并透传；SkillsWriteRequest 加 version、handleSkillsWrite 转 expectedVersion；SkillDetailView 新增 savedVersion 状态（read/save 成功同步，切文件经 loadFile 刷新）；NewSkillModal 改为先 ipcSkillsRead 拿版本再重写。client.ts 零改动（invoke-registry 直接用 SkillsWriteRequest，自动带）。
- 验证：core/desktop typecheck 过（desktop 需先 npm run build -w packages/core 刷新 dist 类型）；core 7 文件 56/56、另 skills+bootstrap+tool 44/44、desktop skill-zip-import 8/8。
- cr-func 结论：func-ready yes（前提 fix edadb49 在内）。亮点：seed 幂等/挂点、两道拦截门、中文报错、四锚点+指路句均与 spec/prd 对齐；56/56 与 typecheck 复现成功。must-fix：empty-state.test.ts 被 seed 打破未修（fixture 的 bootstrap 种入 agent-config，“全新库零技能”不成立，stash 对照确认与 fix 无关）；建议补 writeSkillFile 带 expectedVersion 整文件覆盖正向用例（现测试因旧乐观锁墙绕路，注释已略过时）。spec_deviation：T-AS4 注已记录乐观锁墙但仅当测试策略绕行处理，PRD 验收“内置本体编辑保存正常写入”在 desktop UI 实际由 edadb49 才真正达成；长度口径 PRD ≤200 字 → spec ≤380 字符（已自洽注明）。
