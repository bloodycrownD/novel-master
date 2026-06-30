---
createdAt: '2026-06-23 21:39:57'
updatedAt: '2026-06-28 17:00:00'
---
# agent-run-lifecycle-unify — code-dev-loop 复检

## 状态
**merge-ready**（fix-final 闭合 P1 后）

## 分支
`fix/agent-run-lifecycle-unify`

## HEAD
待 fix-final commit

## outer loop
- cleanup ✅ d186af29
- verify-final ✅ lifecycle 243/243
- cr-final 首轮 not merge-ready → fix-final Desktop onRunStarted stale 守卫

## 验证
- Core lifecycle+allowlist：97/97
- Desktop（无 packaging）：97/97
- Mobile lifecycle：52/52
- 根 build：mobile Buffer TS（无关）

## 集成
- PR → main
- 手工：T8 abort 300ms、T9 跨 run stale
