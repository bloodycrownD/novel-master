/**
 * StorageConfigScreen「数据清理」分区源码契约：T-UIM1。
 *
 * 断言：分区标题（导入导出之后）、体积展示 metrics、dbBusy 守卫、
 * Alert 二次确认、失败 toast（toastMessage('清理失败')）、finally 复位
 * dbBusy。与 provider-detail-tabs.test.ts 同款源码断言手法：整屏依赖
 * runtime/navigation/Toast 上下文，TestRenderer 行为化需逐层 mock，
 * 代价远超收益；交互行为由服务层 T-DMM 系列承担，此处钉住接线。
 */
import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';

const source = readFileSync(
  join(__dirname, '../src/screens/stack/StorageConfigScreen.tsx'),
  'utf8',
);

describe('StorageConfigScreen 数据清理分区 — T-UIM1', () => {
  it('「数据清理」分区标题存在，且位于「导入导出」分区之后', () => {
    const exportIdx = source.indexOf('title="导入导出"');
    const cleanupIdx = source.indexOf('title="数据清理"');
    expect(exportIdx).toBeGreaterThanOrEqual(0);
    expect(cleanupIdx).toBeGreaterThan(exportIdx);
  });

  it('ProfileStatusCard 展示库体积与可回收量（进入页面拉取统计）', () => {
    expect(source).toMatch(/getDatabaseMaintenanceStats/);
    expect(source).toMatch(/label: '库体积'/);
    expect(source).toMatch(/label: '可回收'/);
  });

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
