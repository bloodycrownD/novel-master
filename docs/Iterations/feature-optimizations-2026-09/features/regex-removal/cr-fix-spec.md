# CR Fix Spec: regex-removal

## 元信息
- repo: novel-master；base_sha: ecadd487；head_sha: b0037065（feat/regex-removal）
- prd/spec: docs/Iterations/feature-optimizations-2026-09/features/regex-removal/{prd,spec}.md
- review_round: 1 / dag_version: 1（diff 模式单轮）
- 状态：fix-spec-ready

## Must-fix

### RX/C-1 [P2] 删除 regex import 后的双空行残留
- 维度：C
- 文件：`apps/desktop/src/main/ipc/handlers/messages.ts:40-41`；`apps/mobile/src/services/session-prompt-input.service.ts:21-22`
- 问题：删除 import 行后与既有空行叠加出多余空行，偏离文件惯例
- 改法：各删一个空行
- 验收/测试：两文件 import 区后恰一个空行；触碰包的测试保持绿（纯空行，无行为影响）
- 来源：review-diff-regex-removal / round 1

## Spec deviations
- fixed（说明性）：spec 测试清单建议补记 `packages/core/test/domain/regex/regex-rule-update-depth.test.ts` 为必要连带删除（import 已删模块，不删必编译红）；下次修订 spec 顺手补一句，不阻塞

## Open questions / 待拍板
- `visibleFloorByMessageId`（`packages/core/src/public/chat.ts:306`）成孤儿导出：唯一生产消费方（mobile regex-apply-channel）已删，现仅剩自身单测与 `public-chat-allowlist` 快照引用。拍板是否连带删除（需同步删快照条目与单测）；保留无害。

## 已豁免（用户确认不修）
- 无

## 合并后 QA（manual_user）
- T-RX8：真机从 v1.5.12 存量库升级后启动正常、聊天原文直出、双端设置无正则入口

## K 节建议（下游执行时闭合）
- desktop 两测试 it 标题仍含「regex-apply」字样，可顺手改名（语义仍成立，可不改）
