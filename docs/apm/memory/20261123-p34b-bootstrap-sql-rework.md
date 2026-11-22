# p34-b bootstrap SQL 收口返工（2026-11-23，用户抓出 p34 假清零）

用户两点质问全部成立：novel-master-bootstrap.ts 还有 SQL；smart-sort-rule-schema.ts 是零使用孤儿。**根因是我 p34 的两项流程漏洞**，记为永久纪律：

## 事故一：python replace 无 assert → 假绿灯
§5055 改 seed-builtin-skills 时 3 个 `s.replace(...)` 全部没 assert，old string 不匹配就静默跳过（import 行碰巧匹配改了、两处 SQL 调用没改成），tsc 恰好 0 + 测试本来就绿 → 我按绿灯报了「清零」。
**纪律：任何脚本化文本替换必须 assert old in s；验证必须针对性 grep 旧形态归零，不能只看 tsc/测试。**

## 事故二：check --changed 不查存量
p34 验收只跑 `nm-style check --changed`（改动文件干净即 PASS），bootstrap 存量文件根本不在扫描集。
**纪律：宣称「某目录清零」必须跑该目录级或全量 check；--changed 只担保增量。**

## 普查判读教训
逐符号消费普查输出 `prod_files=1` ——我当时把 1 读成「有消费」，实际 **1 = 只有定义文件自己 = 孤儿**。判读口径：prod_files 含定义文件，<2 即无外部消费。

## 本轮真清零
- novel-master-bootstrap 探测 SQL ×8 → 新 mapper `bootstrap-probe`（sqlite_master 表名可作绑定参数）；pragma_table_info ×6 / PRAGMA user_version ×2 / CREATE TABLE/INDEX ×3 平台硬边界保留并写明理由。
- schema-column-alignments 的 UPDATE vfs_entry → alignVfsEntryHeadVersion。
- 删 3 个孤儿 schema 文件（smart-sort-rule/workplace/skills 的表名常量 mapper 化后零消费；workplace 目录随之删）。
- git add -A 误卷用户的 macro.ts 手改（WebStorm 对象折行）——soft reset + restore --staged 摘除，工作树保留用户形态；该手改形态与 nm-style 规则冲突（--changed exit 1），需用户自行取舍。

## 验收
tsc 0、core 960/0、bootstrap 64/0、skills 80/0、typecheck 15/15、desktop 774/0、mobile 2384/2384、check --changed PASS（macro 摘除后）。commit e9e71c521。
