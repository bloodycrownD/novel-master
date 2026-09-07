/**
 * 救援模式开关（huge-card-import-crash 衍生能力）。
 *
 * 用途：当某台设备因毒数据（如巨型角色卡导入落库）陷入启动崩溃循环时，
 * 本地构建一个「数据库导出专用」救援包发给该设备——启动跳过全部常规 UI，
 * 直接落到导出页，用户导出 .nmbackup 后卸载重装正式版再导入。
 *
 * 使用守则：
 * - 主干（dev）上恒为 false——该能力以惰性代码形式沉淀，正常运行零影响。
 * - 打救援包时：本地把此值改为 true（**不要提交**），再执行
 *   `npm run build:webview:native -w @novel-master/mobile` 与
 *   `./gradlew :app:assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64
 *   -PversionName=<版本>-rescue -PversionCode=999`。
 * - versionCode 用 999 保证覆盖安装；代价是该设备此后装不上任何正式更新
 *   （CI 版本号短期到不了 999），必须卸载重装——这正是救援语义的一部分。
 *
 * @module rescue/rescue-mode
 */
export const RESCUE_EXPORT_MODE = false;
