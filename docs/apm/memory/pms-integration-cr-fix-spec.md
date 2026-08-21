# pms-integration CR fix-spec 撰写记录

## 2026-08-21（round 1，spec-fix-all 节点）
- 请求：为 feat/pms-integration（base 409ceca）撰写 CR fix-spec，路径 docs/Iterations/pms-integration-cr/cr-fix-spec.md；四个 review-scope 合并去重后共 7 条 must-fix（D-1 P0 / A-1·D-2、C-1 P1 / C-2、D-3、D-4、B-nit1 P2），另含 spec deviations、open questions、合并后 QA、K 节建议；只改文档不改实现。
- 撰写时实核要点：
  - D-1：双端 NewSkillModal 的 imported 分支（desktop ipcVfsZipImportBytes / mobile zipSvc.import）确实绕过 writeSkillFile 的 D2② 门（skills.service 约 L295-309）。
  - A-1/D-2：残骸实为整条 done 桥接链路（ChatComposer 调用、client/invoke-registry/handler-registry/handlers 注册与实现、ipc-types 常量与类型），不止评审定位的 ipc-types.ts 两段；grep 零命中验收覆盖全链路。
  - C-1/C-2：hook translateY 仅 Android（约 L49）；ToolPolicyPicker 走 FormOverlayHost 无 KAV；DirectoryRuleSheet styles.form（约 L300）缺 flexShrink。
  - 其余：empty-state.test.ts 两处硬编码 filter；agent-tool get 不 trim / update by-agentId 无判空；seed 指南正文 L45 表述。
- 时点快照：HEAD=a0ebc57，36 commits；docs/apm/memory 本次新建。

## 整体 CR 结论（round 2，fix-spec-ready）

四个 scope 并行（A 协议线/B 工具线/C mobile UI 线/D 内置技能线）→ spec-fix 落盘 → review-full。7+1 条 must-fix：D-1 P0（ZIP 导入绕过保留名）、A-1/D-2 P1（edadb49 带回桥类型两段——spec-fix 曾误报整链带回，主代理 grep+diff 复核修正）、C-1 P1（ToolPolicyPicker iOS 避让退化）、MF-8 P1（mobile ZIP 重写漏传乐观锁，edadb49 只修了 desktop）、C-2/D-3/D-4/B-nit1 P2。B 线唯一 scope-ready。fix-spec：docs/Iterations/pms-integration-cr/cr-fix-spec.md，待用户确认后开工。review-full 顺带跑了 core 202 用例全绿。

## 2026-08-22（fix-P2core 节点：闭合 D-3 / D-4 / B-nit1 三条 P2）
- D-3：empty-state.test.ts 改 import BUILTIN_SKILL_NAMES（src/bootstrap/skills/seed-builtin-skills.js 相对路径），两处 filter 改「除内置名单外为空」；project 域断言不动。
- D-4：agent-tool get by-name 的 input.name 先 trim 再匹配（对齐 update L401 样板），未命中报错文案同步用 trim 后名字。
- B-nit1：update by-agentId 分支在 upsert 前补 getRawWire 判空，null 抛 INVALID_ARGUMENT「未找到该 agentId 对应的 agent」。
- 连带调整：agent-tool.test.ts 原「update by-agentId 直达持久化行（不解析名字）」断言 !getRawWire 会翻红，改为断言判存先行 + upsert 覆盖同一行；新增带空白名 get 命中（D-4）、过期 agentId 报错且 upsert 未调（B-nit1）两条用例。
- 验证：core typecheck 干净；empty-state + agent-tool 共 22 用例全绿。
