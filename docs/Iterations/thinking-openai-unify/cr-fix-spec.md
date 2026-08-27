# CR Fix Spec: thinking-openai-unify

## 元信息
- repo: novel-master（worktree .woktree/thinking-openai-unify）
- base_sha: b3429b0 / head_sha: 5574069
- prd_path: docs/Iterations/thinking-openai-unify/prd.md
- spec_path: docs/Iterations/thinking-openai-unify/spec.md
- review_round: 1 / dag_version: 2
- 状态: fix-spec-ready（trivial 直接执行：零 must-fix 空壳）

## Must-fix（按 P0 → P1 → P2）
- 无必须修复项（round 1 评审结论：通过，P0=P1=P2=0）

## Spec deviations
- none

## Open questions / 待拍板
- CHANGELOG 条目路径：本分支含用户可感知行为变化（GLM「关」档不再显式关断），仓库存在「功能分支补 Unreleased」与「发版前统一补齐」两种先例——需拍板走哪条，避免发版遗漏（不阻塞本分支）
- commit message 中文前缀与 conventional 前缀并存：仓库两种风格皆有先例，如需统一另行约定，不建议 rebase

## 已豁免（用户确认不修）
- 无

## 合并后 QA（manual_user）
- 发布前抓包验证：GLM-4.7 档位「中」请求体仅含 reasoning_effort；anthropic/gemini 各档位请求体与改动前一致（spec 手工验收表）

## K 节建议（下游执行时闭合）
- 无
