# Hermes 真机探针结果（Part B Step 7 硬门禁证据导出）

> 导出于 2026-10-01 合并轮（门禁组第 1 条 ②）：原始落库在 `tmp/probe-db.gz`
> 的 `__fossil_probe_results` 表（`tmp/` 在 `.gitignore`，git 不可跟踪——本文件
> 是其逐字导出，防证据随 tmp 清理消失）。探针脚本
> `apps/mobile/src/services/__fossil-probe.ts` 按临时探针纪律已删除（执行后
> 回捞结果即删，不留在生产源码树）；处置口径见 spec.md Step 7 的结论回记段。

## 表结构（DDL 逐字）

```sql
CREATE TABLE __fossil_probe_results (id INTEGER PRIMARY KEY, case_name TEXT, pass INTEGER, ms REAL, detail TEXT)
```

## 结果（5 行，全 pass）

| id | case_name | pass | ms | detail |
|---|---|---|---|---|
| 1 | probe_start | 1 | 0 | hermes=yes |
| 2 | A_small_cn_4kb | 1 | 25 | v0=4414B v1=4478B delta=139B; encode=21ms decode=4ms; roundtrip_equal=true |
| 3 | B_mixed_1mb | 1 | 13034 | v0=1048576B v1=1048576B delta=11062B; encode=12605ms decode=429ms; roundtrip_equal=true |
| 4 | C_chain_v0_v7 | 1 | 388 | base=65536B final=29222B delta_total=5701B; create=[72,45,45,37,49,36,33]ms total=317ms; apply=[10,10,11,10,10,10,10]ms total=71ms; roundtrip_equal=true |
| 5 | probe_end | 1 | 0 | all cases attempted |

## 结论

Hermes 1MB 编码 12605ms ≈ Node 1.85s 的 6.8×，落在 spec 预估 5-10× 区间；
单组 1MB 编码占 30s 轮预算约 42%。createDelta/applyDelta 回环正确性
（A/B/C 三例 roundtrip_equal 均 true）。**门禁 PASS，fossil 线保留混合方案。**

执行环境：荣耀 EBG-AN00 真机（Hermes），Metro 热更挂探针、结果落库后
`adb exec-out run-as cat` 拉库断言（2026-09-28）。
