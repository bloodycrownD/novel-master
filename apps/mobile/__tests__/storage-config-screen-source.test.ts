/**
 * StorageConfigScreen 重排后源码契约：T-UIM1。
 *
 * 断言：五区顺序（存储空间 → 云端配置 → 数据清理 → 导出 → 导入；存量
 * 数据迁移为存储空间卡之后的独立指标卡，不计入菜单区序）、存储空间卡
 * 体积展示、云端配置入口（进 CloudSyncStorage）、数据清理的 dbBusy 守
 * 卫、Alert 二次确认、失败 toast（toastMessage('清理失败')）、finally
 * 复位 dbBusy、云同步区已迁出本页（不再直接出现同步状态卡与拉取/推送
 * 菜单项）、迁移三行状态行契约（cr-21）与指标轮询接线（ic-23）。与
 * provider-detail-tabs.test.ts 同款源码断言手法：整屏依赖 runtime/
 * navigation/Toast 上下文，TestRenderer 行为化需逐层 mock，代价远超收
 * 益；交互行为由服务层 T-DMM 系列与 storage-config-screen-poll.test.tsx
 * 承担，此处钉住接线。
 */
import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';

const source = readFileSync(
  join(__dirname, '../src/screens/stack/StorageConfigScreen.tsx'),
  'utf8',
);

// ic-22 后第三态分支移入纯函数模块：source 契约钉模块内分支字样，
// 分支行为由 storage-config-migration-values.test.ts 四组夹具直测
const migrationValuesSource = readFileSync(
  join(__dirname, '../src/screens/stack/storage-config-migration-values.ts'),
  'utf8',
);

describe('StorageConfigScreen 分区结构 — T-UIM1', () => {
  it('条目顺序：存储空间卡 → 云端配置 → 数据清理 → 导出数据库 → 导入数据库', () => {
    // 灰色分区小标题已按用户要求移除（卡片/菜单项自带标题，分区标题冗余）；
    // 顺序锚点：存储空间卡 title → 三个菜单项 label
    const storageIdx = source.indexOf('title="存储空间"');
    const cloudIdx = source.indexOf('label="云端配置"');
    const cleanupIdx = source.indexOf('label="数据清理"');
    const exportIdx = source.indexOf('label="导出数据库"');
    const importIdx = source.indexOf('label="导入数据库"');
    expect(storageIdx).toBeGreaterThanOrEqual(0);
    expect(cloudIdx).toBeGreaterThan(storageIdx);
    expect(cleanupIdx).toBeGreaterThan(cloudIdx);
    expect(exportIdx).toBeGreaterThan(cleanupIdx);
    expect(importIdx).toBeGreaterThan(exportIdx);
    expect(source).not.toMatch(/ListSectionTitle/);
  });

  it('ProfileStatusCard 展示库体积与可回收量（进入页面拉取统计）', () => {
    expect(source).toMatch(/getDatabaseMaintenanceStats/);
    expect(source).toMatch(/label: '库体积'/);
    expect(source).toMatch(/label: '可回收'/);
  });

  it('云端配置入口存在：value 显示配置状态，点击进入 CloudSyncStorage', () => {
    expect(source).toMatch(/label="云端配置"/);
    expect(source).toMatch(/cloudConfigured \? '已配置' : '未配置'/);
    // 配置状态经 getCloudSyncLocalStatus 本地读取（kkv），不发 S3 网络请求
    expect(source).toMatch(/getCloudSyncLocalStatus/);
    expect(source).toMatch(/navigation\.navigate\('CloudSyncStorage'\)/);
  });

  it('云同步区已迁出本页：无同步状态卡、无拉取/推送菜单项', () => {
    expect(source).not.toMatch(/title="云同步"/);
    expect(source).not.toMatch(/title="同步状态"/);
    expect(source).not.toMatch(/从云端拉取/);
    expect(source).not.toMatch(/推送到云端/);
    // 全量同步状态（含 S3 网络往返）已整体迁出，本页不得再引用
    expect(source).not.toMatch(/getCloudSyncStatusView/);
  });
});

describe('StorageConfigScreen 数据清理行为 — T-UIM1', () => {
  it('dbBusy 守卫：数据清理 onPress 内 dbBusy 时直接返回', () => {
    expect(source).toMatch(/if \(dbBusy\) \{\s*return;\s*\}/);
  });

  it('Alert.alert 二次确认存在（标题「数据清理」）', () => {
    expect(source).toMatch(/Alert\.alert\(\s*'数据清理'/);
  });

  it("失败 toast 走 toastMessage('清理失败', err)", () => {
    expect(source).toMatch(/toastMessage\('清理失败', err\)/);
  });

  it('finally 中复位 dbBusy（失败也复位）', () => {
    expect(source).toMatch(/\.finally\(\(\) => setDbBusy\(false\)\)/);
  });

  it('确认后调用 runDatabaseMaintenance(runtime)，成功 toast 含前后体积对比', () => {
    expect(source).toMatch(/runDatabaseMaintenance\(runtime\)/);
    expect(source).toMatch(/清理完成/);
  });
});

describe('StorageConfigScreen 存量数据迁移卡片 — 指标卡形态（用户拍板 2026-09-28）', () => {
  it('三行状态行：消息正文压缩 + 版本内容去 base64 + 文件缓存去 base64（相对顺序钉住）', () => {
    expect(source).toMatch(/title="存量数据迁移"/);
    // 三行状态行按此相对顺序渲染（消息正文压缩在前，两张 blob 表在后）
    const compactionIdx = source.indexOf(`label: '消息正文压缩'`);
    const vfsIdx = source.indexOf(`label: '版本内容去 base64'`);
    const fileCacheIdx = source.indexOf(`label: '文件缓存去 base64'`);
    expect(compactionIdx).toBeGreaterThanOrEqual(0);
    expect(vfsIdx).toBeGreaterThan(compactionIdx);
    expect(fileCacheIdx).toBeGreaterThan(vfsIdx);
  });

  it('cr-21: 迁移卡片位于存储空间卡之后（独立指标卡，先于菜单区，读的是拍平后既有形状）', () => {
    // cr-21 原文写「顺序在『数据清理』之后」——与重排后的现状不符：
    // 迁移指标卡排在存储空间卡之后、云端配置菜单之前（数据清理之前）。
    // 此处按现状钉住相对位置；若后续用户拍板把迁移卡挪到数据清理之后，
    // 本断言需同步改（位置契约以页面现状为准，不为本轮新增搬动）。
    const storageIdx = source.indexOf('title="存储空间"');
    const migrationIdx = source.indexOf('title="存量数据迁移"');
    const cloudIdx = source.indexOf('label="云端配置"');
    const cleanupIdx = source.indexOf('label="数据清理"');
    expect(migrationIdx).toBeGreaterThan(storageIdx);
    expect(migrationIdx).toBeLessThan(cloudIdx);
    expect(migrationIdx).toBeLessThan(cleanupIdx);
  });

  it('cr-21: blob 状态行 value 取自 blobBinary 数组（拍平形态，按 table 查找）', () => {
    // value 数据源是 service 拍平后的 BlobBinaryTableStatus[]（ic-22 抽出的
    // 纯函数 + 组件内 find），不是 desktop 侧的 { tables } 包装形状
    expect(source).toMatch(/blobBinary\.find\(row => row\.table === 'vfsContent'\)/);
    expect(source).toMatch(/blobBinary\.find\(row => row.table === 'fileCache'\)/);
    expect(source).toMatch(/from '\.\/storage-config-migration-values'/);
  });

  it('指标卡只读展示：迁移行不以 ProfileMenuItem 菜单项渲染', () => {
    expect(source).not.toMatch(/label="消息正文压缩"/);
    expect(source).not.toMatch(/label="版本内容去 base64"/);
    expect(source).not.toMatch(/label="文件缓存去 base64"/);
  });

  it('cr-06 第三态：done 且 failedCount > 0 时显示「已完成（N 条需人工处理）」（分支在纯函数模块）', () => {
    // 分支行为（四组夹具）由 storage-config-migration-values.test.ts 直测；
    // 此处钉住模块内第三态分支与消费接线
    expect(migrationValuesSource).toMatch(/failedCount > 0/);
    expect(migrationValuesSource).toMatch(/条需人工处理/);
    expect(source).toMatch(/from '\.\/storage-config-migration-values'/);
  });

  it('消息正文「去 base64」不设状态行（发版形态无用户可见中间态）', () => {
    expect(source).not.toMatch(/消息正文去 base64/);
  });

  it('ic-23（方案 A）：聚焦轮询接线——useFocusEffect 内 setInterval，cleanup 里 clearInterval', () => {
    expect(source).toMatch(/useFocusEffect\(/);
    const intervalIdx = source.indexOf('setInterval(');
    const focusIdx = source.indexOf('useFocusEffect(');
    expect(intervalIdx).toBeGreaterThan(focusIdx);
    // 同一 cleanup 覆盖失焦/卸载：clearInterval 在 useFocusEffect 的
    // cleanup 返回函数里
    expect(source).toMatch(/return \(\) => clearInterval\(interval\)/);
  });

  it('T-VP22: 第四行「历史版本打包」排在文件缓存去 base64 之后（相对顺序钉住）', () => {
    const fileCacheIdx = source.indexOf(`label: '文件缓存去 base64'`);
    const vfsPackIdx = source.indexOf(`label: '历史版本打包'`);
    expect(fileCacheIdx).toBeGreaterThanOrEqual(0);
    expect(vfsPackIdx).toBeGreaterThan(fileCacheIdx);
  });

  it('T-VP22: 第四行取值走 vfsPackValue 纯函数、数据源经 vfsPack state 接线', () => {
    expect(source).toMatch(/vfsPackValue\(vfsPack\)/);
    expect(source).toMatch(/setVfsPack\(stats\.vfsPack\)/);
    expect(source).toMatch(/from '\.\/storage-config-migration-values'/);
  });

  it('T-VP22: 第四行同样只读展示（不以 ProfileMenuItem 菜单项渲染）', () => {
    expect(source).not.toMatch(/label="历史版本打包"/);
  });

  it('T-VP22: 第三态分支在纯函数模块（failedGroups > 0 与「组需人工处理」字样）', () => {
    // 分支行为（夹具直测）由 storage-config-migration-values.test.ts 的
    // vfsPackValue describe 承担；此处钉住模块内第三态分支字样
    expect(migrationValuesSource).toMatch(/failedGroups > 0/);
    expect(migrationValuesSource).toMatch(/组需人工处理/);
  });
});
