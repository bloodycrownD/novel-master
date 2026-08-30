/**
 * ProviderDetailScreen / ProvidersScreen（mobile）tab 化测试：T-T1 / T-T4。
 *
 * - T-T1：ProviderDetailScreen 顶部有 SegmentedControl，两个 tab（服务商配置 + 模型管理）
 * - T-T4：ProvidersScreen 的 BottomSheetMenu 无「编辑」项
 *
 * 整屏组件依赖太重（runtime/navigation/modals），用源码断言更稳，与 desktop 对称。
 */
import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';

const detailPath = join(
  __dirname,
  '../src/screens/stack/ProviderDetailScreen.tsx',
);
const listPath = join(__dirname, '../src/screens/stack/ProvidersScreen.tsx');
const detailSource = readFileSync(detailPath, 'utf8');
const listSource = readFileSync(listPath, 'utf8');

describe('ProviderDetailScreen (mobile) — T-T1', () => {
  it('顶部有 SegmentedControl，两个 tab（服务商配置 + 模型管理）', () => {
    expect(detailSource).toMatch(/import.*SegmentedControl/);
    expect(detailSource).toMatch(/\{value: 'config', label: '服务商配置'\}/);
    expect(detailSource).toMatch(/\{value: 'models', label: '模型管理'\}/);
  });

  it('默认 tab 是「服务商配置」（create 后直接可编辑）', () => {
    expect(detailSource).toMatch(/useState<'config' \| 'models'>\('config'\)/);
  });

  it('服务商配置 tab 内嵌 ProviderForm mode="edit"', () => {
    expect(detailSource).toMatch(/<ProviderForm\s+mode="edit"/);
  });

  it('模型管理 tab 保留 ManageHeader + 模型列表（含添加/远程）', () => {
    expect(detailSource).toMatch(/title="已保存模型"/);
    expect(detailSource).toMatch(/navigation\.navigate\('ModelSampling'/);
  });

  it('删模型批量模式接入全选（onSelectAll + allSelected，全选后可清空）', () => {
    expect(detailSource).toMatch(/onSelectAll=\{/);
    expect(detailSource).toMatch(/allSelected=\{/);
    expect(detailSource).toMatch(/rows\.map\(row => row\.savedModelId\)/);
  });

  it('ProviderEdit 路由已删除（无 import / navigate ProviderEdit）', () => {
    expect(detailSource).not.toMatch(/navigate\('ProviderEdit'/);
  });
});

describe('ProvidersScreen (mobile) — T-T4', () => {
  it('BottomSheetMenu 无「编辑」项', () => {
    // 菜单 items 数组里只剩删除
    const itemsMatch = listSource.match(/items=\{\[([\s\S]*?)\]\}/);
    expect(itemsMatch).toBeTruthy();
    expect(itemsMatch![1]).not.toMatch(/action: 'edit'/);
    expect(itemsMatch![1]).toMatch(/action: 'delete'/);
  });

  it('handler 无 edit 分支、无 navigate ProviderEdit', () => {
    expect(listSource).not.toMatch(/if \(action === 'edit'\)/);
    expect(listSource).not.toMatch(/navigate\('ProviderEdit'/);
  });
});
