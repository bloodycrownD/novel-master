# p34 bootstrap 内联 SQL 漏网清零（2026-11-23）

用户发起：bootstrap 空目录清理 + `src/bootstrap/smart-sort-rule` 为什么还有内联 SQL（不是 generated 产物）。

## 根因（mapper 推广轮的漏斗盲区）
mapper 推广工作流的漏斗只扫 **TdbcTemplate 文本调用**；bootstrap 层走 `conn.query/conn.execute` **位置参数**形态的 SQL 全部漏网。本轮清出三处 + 登记两类合理保留：
- smart-sort-rule：`INSERT OR IGNORE` → mapper 新增 `insertBuiltinRule`（enabled 字面 1、主键冲突整行忽略）。
- seed-builtin-skills：台账读 `getValueByKey`、写 `upsert`——**复用 kkv.mapper 现有语句**（ON CONFLICT DO UPDATE 与 OR REPLACE 对仅 (module,key,value) 三列的台账行语义等价且更温和，无需新语句）。
- 合理保留：pragma_table_info 表结构自省 ×5（动态表名是 SQLite pragma 固有形态，mapper 不支持）；VFS_CONTENT_PACK_SCHEMA_STATEMENTS DDL 执行循环（schema.generated 同款 DDL 通道，misc 片既有豁免）。

## 收尾教训
- **空目录 git 不跟踪**：DDL 收敛轮清 schema ts 后留下的 8 个空子目录（agent/chat/kkv/message-checkpoint/session-kkv/session-run-state/sksp/usage）一直躺在工作树里，`rmdir` 即净（无 git 操作）。
- bootstrap seed 的 parser 用法：`new SqlTemplateParser()` 局部实例即可（repository 是构造期字段，seed 是无状态函数用局部）。
- TdbcTemplate/SqlTemplateParser 的 import 真实路径：`@/infra/tdbc/logic/template-helper.js` 与 `@/infra/sql-template/index.js`（不要猜）。

## 验收
tsc 0、core 960/0、bootstrap 64/0、skills 80/0、smart-sort-rule 67/0、typecheck 15/15、desktop 774/0、mobile 2384/2384、nm-style PASS、dist 重建。commit 27de676e3，tag p34-bootstrap-sql-cleanup。
