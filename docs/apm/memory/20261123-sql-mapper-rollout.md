# SQL mapper 推广全仓 + yaml 拆域 + DDL 收敛（2026-11-23）

三个提交（p27-backlog 分支）：`1e4f8623c` yaml 按域拆分、`dc9c240fa` DDL 收敛、`66d17648c` mapper 推广。

## 三条产出

1. **catalog yaml 按域拆分**：`src/i18n/catalog/{zh-CN,en-US}.yaml`（1831 行）拆成 5 个域文件
   （error/label/ui/chat/settings.yaml），文件名=顶层段、每文件顶层 zh-CN/en-US 双语段——
   改一条文案只开一个文件且双语邻近对照。生成器按文件装载，locale 段与唯一域层双断言。
2. **bootstrap DDL 收敛**：18 个 `*-schema.ts` → `resources/sql/schema/` 17 个域 `.sql`
   + `generated/schema.generated.ts`（`CHAT_SCHEMA_STATEMENTS` 等导出名不变，装配零改动）。
   3 个表名常量文件瘦身保留（repo 消费的契约）；15 个纯数组文件退役。
   生成器扩 schema 模式：按分号切语句（`BEGIN...END` 触发器体感知——体内分号不切分）。
3. **SQL mapper 推广**：22 个 mapper、199 条语句，全仓内联 SQL 清零（工作流 dwfrun-db88ec55
   7 片并行 + 手补 3 处跨表）。repo 只留 generated 引用；`<foreach>` 收编 IN 清单程序生成
   （buildInBindings 退役）、`<if>` 收编条件拼接。保留不迁（写明理由）：
   base-sqlite-chat-repository 的 `${this.table}` 结构拼装（差异部分改从生成物注入
   selectColumns/insert）、provider-table-snapshot 动态表 INSERT、schema-migrations 的
   ensure DDL（裸 execute 不走 TdbcTemplate、mapper 无 DDL 标签）。

## 两条硬教训

### ① tsconfig.tsbuildinfo 不在 dist 内（#279 的完整版）

重建 workspace dist 只 `rm -rf dist` **不够**：`packages/core/tsconfig.tsbuildinfo` 在项目根，
`rm -rf dist` 后它仍记着「全部已编译」→ `tsc --build` 增量跳过 → 产出残缺 dist
（只有部分 .d.ts.map，没有 .js）→ apps 测试 `ERR_MODULE_NOT_FOUND core/dist/public/agent.js`，
desktop 99 红。**正确重建**：`rm -rf dist tsconfig.tsbuildinfo` 再跑完整 build script
（`tsc --build tsconfig.json && tsc-alias -p tsconfig.json`——裸 tsc --build 还会漏
tsc-alias 的 `@/` 别名重写，app 端照样解析不了）。

### ② XML mapper 里的反斜杠会被 generated 模板字面量吞

`.mapper.xml` 里写 `ESCAPE '\'`（单反斜杠）→ 生成物是 JS 模板字面量 → `\'` 被当转义引号
吞掉 → 运行时 `SQLITE_ERROR: ESCAPE expression must be a single character`。
**XML 源写双反斜杠 `ESCAPE '\\'`**，运行时还原单字符。已在相关 mapper 头部登记。

## 工作流编排（本轮复用的模式）

- 生成器加 `--only <base>`（可多次）：并行分片各自 `--only` 重生成互不覆盖；收敛段全量。
- 分片任务书内嵌：互斥文件清单 + 样板规则 11 条（照抄 chat-message 样板）。
- world.run 无 cwd、npm shim 不可用：统一 `node -e` + `process.chdir` + `spawnSync`，
  tsc 直调 `node_modules/typescript/bin/tsc`，tsc-alias 直调
  `node_modules/tsc-alias/dist/bin/index.js`。
- 工作流的 apps 测试是在 **旧 dist** 上跑的（收敛段只 tsc 没 build）——exit 0 是假绿；
  主代理收尾必须重建 dist 复跑两端。

## 验证终态

core 960/0、desktop 774/0、mobile 2384/0、typecheck 15/15、nm-style 硬段 0
（signatures/top-let/throw-audit 全 0，mapper 文件零 FIND）。

## 后续两轮结构收口（0616ce0d7 / 18a83f0a8）

- resources/sql 收口 mapper/ 子目录（22 xml 与 schema/ 对称）；gen 脚本 mapperDir 同步。
- i18n yaml 源迁 resources/i18n（5 个 catalog yaml 与 sql 同居包根 resources）：
  **非 TS 源统一住 resources/** 成为包结构约定。gen 脚本 catalogDir、测试 CATALOG_DIR、
  keys.ts 文档注释同步；删掉零消费的 ./i18n/catalog/* 通配 exports（双轨收敛残留，
  具名 chat/settings 走 dist generated、jest 映射指向 dist，不受影响）。
- 边界口径：src/ 只装 TS 代码与 generated 产物；resources/ 只装人写的非 TS 源
  （XML/SQL/YAML），不入公开面、不被 tsc/nm-style 扫。

## 第 4 课：工作流产物提交前必须亲自跑全量门禁（2026-11-23 补）

mapper 工作流自报 nm-style exit 0，我复核时 check . 也是 signatures=0，提交
（66d17648c）后用户指出参数折行问题才发现：vfs-revision 有 3 处 query<{...}>
类型字面量折行（子代理晚写入竞态，逃过 style 段与我的复核扫描）。
**纪律：工作流产物的收尾提交前，主代理必须自己跑一次全量 check . 再 commit**；
复核的扫描结果与提交动作之间不能再有子代理活着。

