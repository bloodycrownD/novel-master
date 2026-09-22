/**
 * StorageConfigScreen 重排后源码契约：T-UIM1。
 *
 * 断言：四区顺序（存储空间 → 云端配置 → 数据清理 → 导入导出）、
 * 存储空间卡体积展示、云端配置入口（进 CloudSyncStorage）、数据清理的
 * dbBusy 守卫、Alert 二次确认、失败 toast（toastMessage('清理失败')）、
 * finally 复位 dbBusy，以及云同步区已迁出本页（不再直接出现同步状态卡
 * 与拉取/推送菜单项）。与 provider-detail-tabs.test.ts 同款源码断言手法：
 * 整屏依赖 runtime/navigation/Toast 上下文，TestRenderer 行为化需逐层
 * mock，代价远超收益；交互行为由服务层 T-DMM 系列承担，此处钉住接线。
 */
import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';

const source = readFileSync(
  join(__dirname, '../src/screens/stack/StorageConfigScreen.tsx'),
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
    expect(source).toMatch(/navigation\.navigate\('CloudSyncStorage'\)/);
  });

  it('云同步区已迁出本页：无同步状态卡、无拉取/推送菜单项', () => {
    expect(source).not.toMatch(/title="云同步"/);
    expect(source).not.toMatch(/title="同步状态"/);
    expect(source).not.toMatch(/从云端拉取/);
    expect(source).not.toMatch(/推送到云端/);
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
