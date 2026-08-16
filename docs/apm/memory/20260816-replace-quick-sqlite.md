---
date: 2026-08-16 13:00
title: replace-quick-sqlite——移动端 SQLite 驱动迁移至 op-sqlite，本地验证进行中待真机验收
keywords: op-sqlite, quick-sqlite, SQLITE_TEMP_STORE, disk I/O error, 平行包, 回滚线, tdbc-driver, 类型遮蔽补丁
abstract: 真机大事务 disk I/O error 根因是 Android 12 及以下部分设备临时目录不可写（op-sqlite issue #137），编译期 SQLITE_TEMP_STORE=2 + 运行期 PRAGMA temp_store=MEMORY 双保险解决。用户建议的平行包方案落地（packages/tdbc-driver-op-sqlite，回滚 = mobile 两行）；op-sqlite 18.0.0 类型 re-export bug 用 src/op-sqlite.d.ts ambient 遮蔽（升级后要删）。状态：本地验证进行中，待真机验收（T-MIG1/T-MIG2）。
---

user:
移动端 quick-sqlite 在真机上炸了：25MB 存量库跑 table-constraints-v1b migration，事务累计写约 3MB 后稳定报 disk I/O error，bootstrap 失败进不了应用，偶尔还有 SIGSEGV 闪退循环。桌面端 better-sqlite3 同一份数据 100% 成功。quick-sqlite 作者已废弃这个库，是不是该换后继库了？

assistant:
查下来不是我们代码的锅，是社区同源问题（op-sqlite issue #137，引 quick-sqlite #80）：Android 12 及以下，大事务触发 SQLite 写临时文件时，部分设备的临时目录不可写，直接 disk I/O error。quick-sqlite 废弃不会修；op-sqlite 有官方文档背书的编译期解法 -DSQLITE_TEMP_STORE=2。选型定为 @op-engineering/op-sqlite@18.0.0（含 bridge invalidation SIGSEGV 修复 PR #434/#436；发布仅数天，真机若出新问题回退 17.2.0，一行依赖改动）。nitro-sqlite 因需额外引入 nitrogen 代码生成链且文档自相矛盾落选。

user:
换库别动旧包，搞个平行新包吧，回滚要便宜。

assistant:
采纳，这是用户建议的关键决策。新增 packages/tdbc-driver-op-sqlite 平行包（协议层约 300 行复制改名换取完全隔离，tdbc-driver-rn 零改动保留），回滚 = mobile 侧两行（registerOpSqliteDriver→registerRnDriver、driver 'op-sqlite'→'rn'）重装即回，旧依赖原样在树里，无版本冲突无数据迁移。防 disk I/O error 双保险：仓库根 package.json 的 op-sqlite.sqliteFlags 配 -DSQLITE_TEMP_STORE=2（op-sqlite 配置读取向上遍历找第一个 package.json，monorepo 必须放根，放错层级会静默不生效）+ OpSqliteDriver.open 时 PRAGMA temp_store = MEMORY 运行期兜底。存量库兼容：open 先探测 quick-sqlite 旧布局 DocumentDir/default/novel_master_vfs，存在则绝对路径原地打开，不允许丢库；db-file-path 候选路径保留两种布局。

坑一枚：op-sqlite 18.0.0 发布的 lib/typescript/src/index.d.ts 里 `export * from "./functions"` 是无扩展名相对导入，NodeNext 解析下静默解析为空（skipLibCheck 掩盖了报错），open/openAsync 等导出全部丢失（TS2305）。解法是 packages/tdbc-driver-op-sqlite/src/op-sqlite.d.ts 用 ambient 模块声明遮蔽坏掉的发布类型，只声明本包实际用到的最小表面——升级到修复版 op-sqlite 后要删。

状态：本地验证进行中（新包测试 + mobile jest + 旧包零改动回归），待真机验收——T-MIG1 存量库 migration 完整跑通 + getDbPath() 核对库文件路径 + 读写/备份回归（T-MIG2）。真机通过后旧包删除属后续 cleanup 迭代，届时协议层 300 行复制一并消除。
