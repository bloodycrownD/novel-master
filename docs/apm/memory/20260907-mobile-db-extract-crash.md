---
date: 2026-09-07 01:07
title: 真机崩溃后如何取出 SQLite 数据库文件
keywords: [adb, run-as, databases, novel_master_vfs, WAL, 崩溃, 取库, 内部存储]
abstract: 手机文件管理器看不到 DB 的原因（/data/data 私有目录）与 adb run-as 取库的完整命令（含 -wal/-shm 伴生文件），及 release 包无 root 取不了库的边界。
---

user: novelmaster 软件崩溃了，我如何获取 db 文件呢？我发现直接在手机文件管理器没找到。

assistant: 查了 apps/mobile/src/db/db-file-path.ts 与 db-backup.service.ts 确认：DB 用 op-sqlite 默认布局落在 `/data/data/com.novelmaster/databases/novel_master_vfs`（无 .db 后缀；quick-sqlite 旧布局候选为 files/default/ 下带 .db）。这是应用私有内部存储，Android 沙箱下文件管理器天然看不到。取法：debug 包（npm run android / nightly 装的）用 `adb exec-out run-as com.novelmaster cat databases/novel_master_vfs > novel_master_vfs` 拉出，库开 WAL，崩溃时近期事务在 -wal 里，需连 -shm 一起拉、三文件同目录放置后本地打开自动恢复；`run-as ... ls` 报 not debuggable 说明装的是 release 包，allowBackup=false 已堵死 adb backup，无 root 只能靠应用内「数据库备份导出」（.nmbackup，文档选择器落盘）——前提是应用还能启动到该页面。

user: 所以 release 完全没有其他办法了吗？

assistant: 又翻出三条路：①云同步快照——cloud-sync.service.ts 会把全量 .nmbackup 快照（导出时 scrub 掉服务商表）推到用户自配的 S3 兼容桶（pathPrefix 下 snapshots/ + status.json），手动触发（CloudSyncProgressScreen），配过并推送过就能在 PC 上直接从桶里取，完全不碰手机；②同签名救援包——Android 覆盖安装保数据只校验签名证书不看 debuggable，build.gradle 的 release 签名在无 ANDROID_KEYSTORE_FILE 等 secrets 时回退到 checked-in debug.keystore（与 debug 变体同证书），因此本地 `./gradlew assembleDebug -PversionCode=999` 后 `adb install -r` 覆盖装（绝不先卸载/清数据），装完不用启动应用、run-as 直接可用；CI 配了真 keystore 时就取回自己的 secrets、临时给 release buildType 加 debuggable true、先 npm run build:webview:native 再 assembleRelease 覆盖装；③已 root 设备直接拉，但现在才解锁 bootloader=清数据=自毁。签名比对法：pm path → pull base.apk → keytool -printcert -jarfile 对比 debug.keystore 的 keytool -list SHA-256。adb bugreport 只含日志不含应用数据；小米/华为等 OEM 本地备份（系统级）对第三方私有数据覆盖率看机型，可一试。
