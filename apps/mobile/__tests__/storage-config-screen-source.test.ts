/**
 * StorageConfigScreen 重排后源码契约：T-UIM1。
 *
 * 断言：五区顺序（存储空间 → 云端配置 → 数据清理 → 导出 → 导入）、存储
 * 空间卡体积展示、云端配置入口（进 CloudSyncStorage）、数据清理的
 * dbBusy 守卫、Alert 二次确认、失败 toast（ToastMessage.toast('清理失败')）、
 * finally 复位 dbBusy、云同步区已迁出本页（不再直接出现同步状态卡与
 * 拉取/推送菜单项）。与 provider-detail-tabs.test.ts 同款源码断言手法：
 * 整屏依赖 runtime/navigation/Toast 上下文，TestRenderer 行为化需逐层
 * mock，代价远超收益；交互行为由服务层 T-DMM 系列承担，此处钉住接线。
 *
 * 「存量数据迁移」卡片相关契约（cr-21 / ic-23 / T-VP22）已随第七轮退役
 * 整卡移除（v1.5.41 同批）。
 */
import {describe, expect, it} from '@jest/globals';
import {CloudSyncConfigStore} from '@/services/cloud-sync-config.store';
import {ToastMessage} from '@/errors/toast-message';
import {readFileSync} from 'fs';
import {join} from 'path';

const source = readFileSync(
  join(__dirname, '../src/screens/stack/StorageConfigScreen.tsx'),
  'utf8',
);

describe('StorageConfigScreen 分区结构 — T-UIM1', () => {
  it('条目顺序：存储空间卡 → 云端配置 → 数据清理 → 导出数据库 → 导入数据库', () => {
    // 灰色分区小标题已按用户要求移除（卡片/菜单项自带标题，分区标题冗余）；
    // 顺序锚点：存储空间卡 title → 三个菜单项 label（i18n 后锚 coreT 形态+键名，文案由 catalog 保证）
    const storageIdx = source.indexOf('title={coreT({key: "ui.storage.space_section"})}');
    const cloudIdx = source.indexOf('label={coreT({key: "ui.storage.cloud_entry"})}');
    const cleanupIdx = source.indexOf('label={coreT({key: "ui.storage.cleanup_section"})}');
    const exportIdx = source.indexOf('label={coreT({key: "ui.storage.export_db"})}');
    const importIdx = source.indexOf('label={coreT({key: "ui.storage.import_db"})}');
    expect(storageIdx).toBeGreaterThanOrEqual(0);
    expect(cloudIdx).toBeGreaterThan(storageIdx);
    expect(cleanupIdx).toBeGreaterThan(cloudIdx);
    expect(exportIdx).toBeGreaterThan(cleanupIdx);
    expect(importIdx).toBeGreaterThan(exportIdx);
    expect(source).not.toMatch(/ListSectionTitle/);
  });

  it('ProfileStatusCard 展示库体积与可回收量（进入页面拉取统计）', () => {
    expect(source).toMatch(/DbMaintenanceService\.getStats/);
    expect(source).toMatch(/label: coreT\(\{key: "ui\.storage\.db_size"\}\)/);
    expect(source).toMatch(/label: coreT\(\{key: "ui\.storage\.reclaimable"\}\)/);
  });

  it('云端配置入口存在：value 显示配置状态，点击进入 CloudSyncStorage', () => {
    expect(source).toMatch(/label=\{coreT\(\{key: "ui\.storage\.cloud_entry"\}\)\}/);
    expect(source).toMatch(/cloudConfigured \? coreT\(\{key: "ui\.cloud_sync\.configured"\}\) : coreT\(\{key: "ui\.cloud_sync\.not_configured"\}\)/);
    // 配置状态经 CloudSyncConfigStore.getLocalStatus 本地读取（kkv），不发 S3 网络请求
    expect(source).toMatch(/CloudSyncConfigStore\.getLocalStatus/);
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
    expect(source).toMatch(/Alert\.alert\(\s*coreT\(\{key: "ui\.storage\.cleanup_section"\}\)/);
  });

  it("失败 toast 走 ToastMessage.toast('清理失败', err)", () => {
    expect(source).toMatch(/ToastMessage\.toast\(coreT\(\{key: "ui\.common\.cleanup_failed"\}\), err\)/);
  });

  it('finally 中复位 dbBusy（失败也复位）', () => {
    expect(source).toMatch(/\.finally\(\(\) => setDbBusy\(false\)\)/);
  });

  it('确认后调用 DbMaintenanceService.run(runtime)，成功 toast 含前后体积对比', () => {
    expect(source).toMatch(/DbMaintenanceService\.run\(runtime\)/);
    expect(source).toMatch(/coreT\(\{key: "ui\.storage\.cleanup_done", params: \{before, after\}\}\)/);
  });
});
