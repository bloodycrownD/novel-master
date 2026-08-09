# D5-2：Fix-Spec Closure

| 项 | 状态 |
|----|------|
| fix-spec-ready | yes |
| fix_spec_path | docs/review/phase5-fix-spec/D5-1-fix-spec.md |
| dag_version / review_round | 7 / Phase 5 wave 5a+5b |
| base_sha | 3166a96e7341a336177c1cb3d9b9d19b7303a003 |
| S 级（已写入 fix-spec） | 9 |
| A 级（已写入 fix-spec） | 19 |
| 未写入的开放 must-fix | 0 |
| spec_deviations | **none**（2 条均已 fixed：用户授权改业务 spec + 撤 chat_grep） |
| 待拍板项 | **0**（15 条全部由主代理按「可维护/性能/干净」三线拍板，见 fix-spec「决策记录」节） |
| C-orch | N/A（本 loop 非单 PR 评审） |
| C 类合并后 QA | 见 fix-spec「合并后 QA」节（含 undo_send 数据丢失验收、customAttach round-trip 验收、SKSP 三端 env parity 验收） |

## fix-spec-ready 判定依据

1. **债务登记全覆盖**：D3-2 的 28 条债务（S 级 9 + A 级 19）全部已写入 fix-spec，无遗漏。
2. **每条 must-fix 三要素齐全**：改法 + 触达文件 + 验收/测试。无「只批评无改法」条目。
3. **spec_deviations 全部闭合**：2 条均已 fixed（用户授权改业务 spec + 撤 chat_grep）。
4. **待拍板项全部闭合**：15 条已由主代理按「可维护/性能/干净」三线拍板，决策回填进 fix-spec「决策记录」节。
5. **Closure 表已附**：本文件。

## 不等于

- **不等于**代码已修完或可合并——本 Phase 只管「修复说明书可执行」，不改代码。

## 下游执行建议

1. 按 D4-1 的 P0→P1→P2 波次执行修复（待拍板项已全闭合，无需再等决策）
2. P0-1（CI / S-3）必须最先——后面的测试验收都依赖它
3. A-28（knip 配置）建议紧随 CI——S-5（死代码清扫）依赖干净的 knip 输出
4. A-9 ↔ S-2 ↔ A-20 ↔ A-25 是 SKSP 三端对齐的同一个执行单元，建议合并到一个执行 loop
5. S-1 ↔ S-8 共建跨资源写编排抽象，建议合并到一个执行 loop
