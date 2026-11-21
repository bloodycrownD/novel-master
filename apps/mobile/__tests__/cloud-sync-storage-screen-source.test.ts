/**
 * CloudSyncStorageScreen 源码契约（照 storage-config-screen-source.test.ts 手法）。
 *
 * 断言：同步状态卡（rev 对齐 metrics 与 notice）、refreshCloudSyncStatus
 * 状态刷新、云存储配置入口（进 CloudSyncConfig）、拉取/推送菜单项与
 * 拉取的 Alert 二次确认。与 provider-detail-tabs.test.ts 同款源码断言：
 * 整屏依赖 runtime/navigation 上下文，TestRenderer 行为化需逐层 mock，
 * 代价远超收益；同步交互行为由服务层 T-DMM 系列承担，此处钉住接线。
 *
 * R6 波 4a：文案随 coreT descriptor 接线改为锁 coreT 调用形态 + 键名
 * （断言意图不变：仍是钉住同一批 UI 挂点）。
 */
import {describe, expect, it} from '@jest/globals';
import {readFileSync} from 'fs';
import {join} from 'path';

const source = readFileSync(
  join(__dirname, '../src/screens/stack/CloudSyncStorageScreen.tsx'),
  'utf8',
);

describe('CloudSyncStorageScreen 云端存储设置页', () => {
  it('同步状态卡存在：展示云端/本机 rev 与对齐提示', () => {
    expect(source).toMatch(/title=\{coreT\(\{key: "ui\.cloud_sync\.sync_status"\}\)\}/);
    expect(source).toMatch(/label: coreT\(\{key: "ui\.cloud_sync\.rev_cloud"\}\)/);
    expect(source).toMatch(/label: coreT\(\{key: "ui\.cloud_sync\.rev_local"\}\)/);
    expect(source).toMatch(/ui\.cloud_sync\.cloud_newer_hint/);
  });

  it('进入页面经 refreshCloudSyncStatus 拉取同步状态（getCloudSyncStatusView）', () => {
    expect(source).toMatch(/CloudSyncService\.getStatusView/);
    expect(source).toMatch(/refreshCloudSyncStatus/);
    expect(source).toMatch(/useFocusEffect/);
  });

  it('云存储配置入口存在：value 显示配置状态，点击进入 CloudSyncConfig', () => {
    expect(source).toMatch(/coreT\(\{key: "ui\.nav\.cloud_storage"\}\)/);
    expect(source).toMatch(/cloudConfigured \? coreT\(\{key: "ui\.cloud_sync\.configured"\}\) : coreT\(\{key: "ui\.cloud_sync\.not_configured"\}\)/);
    expect(source).toMatch(/navigation\.navigate\('CloudSyncConfig'\)/);
  });

  it('拉取/推送菜单项存在，均跳转 CloudSyncProgress（op 区分）', () => {
    expect(source).toMatch(/coreT\(\{key: "ui\.cloud_sync\.pull_title"\}\)/);
    expect(source).toMatch(/coreT\(\{key: "ui\.cloud_sync\.push_title"\}\)/);
    expect(source).toMatch(
      /navigation\.navigate\('CloudSyncProgress', \{op: 'pull'\}\)/,
    );
    expect(source).toMatch(
      /navigation\.navigate\('CloudSyncProgress', \{op: 'push'\}\)/,
    );
  });

  it('从云端拉取有 Alert 二次确认，取消/拉取两个动作', () => {
    expect(source).toMatch(/Alert\.alert\(coreT\(\{key: "ui\.cloud_sync\.pull_title"\}\), coreT\(\{key: "ui\.cloud_sync\.pull_confirm_msg"\}\)/);
    expect(source).toMatch(/text: coreT\(\{key: "ui\.common\.cancel"\}\), style: 'cancel'/);
    expect(source).toMatch(/text: coreT\(\{key: "ui\.cloud_sync\.pull_action"\}\)/);
  });

  it('Agent 运行中守卫：同步操作在 agentActive 时禁用', () => {
    expect(source).toMatch(/agentActivity\.isActive/);
    expect(source).toMatch(/syncControlsDisabled = agentActive/);
    expect(source).toMatch(/ui\.cloud_sync\.agent_active_note/);
  });
});
