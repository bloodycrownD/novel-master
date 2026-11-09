/**
 * 全仓裸 console 基线守卫（spec C31 / §7.3 二段式第 2 段）。
 *
 * 扫描 `apps/mobile/src/**`（排除 `src/web/**`）：`src/web` 的 `main.ts` /
 * `ToolGroup.tsx` 是 web bundle 装配失败诊断的唯一出口（无 logger 依赖），
 * 按 §7.3 保留。`debug/run-timing.ts`（`__DEV__` 门控）与
 * `services/log-sink.mobile.ts`（日志落盘 sink 本尊）两个白名单单独固定；
 * 其余业务文件按本轮实测基线**只允许下降**。
 *
 * 基线来源：spec §7.3 本轮实测 20 文件 / 51 处（白名单 2 文件 / 6 处 +
 * 业务 18 文件 / 45 处）。Step 10 把 `session-stream-unit`（5 处）与
 * `session-stream-unit-manager`（10 处）收口到 `createLogger`，实际降到
 * 18 文件 / 36 处——基线不变，下降天然放行；新增文件或计数上升即红。
 */
import {readFileSync, readdirSync} from 'node:fs';
import {join, relative} from 'node:path';

const SRC_ROOT = join(__dirname, '../src');

/** 白名单：需保留的系统级 console（固定计数，不参与业务 45 处预算）。 */
const WHITELIST_BASELINE: Readonly<Record<string, number>> = {
  'src/debug/run-timing.ts': 5,
  'src/services/log-sink.mobile.ts': 1,
};

/** 业务文件既有基线（spec §7.3 实测；计数只允许下降）。 */
const BUSINESS_BASELINE: Readonly<Record<string, number>> = {
  'src/components/chat/useChatComposerController.ts': 1,
  'src/db/connection.ts': 2,
  'src/runtime/novel-master-context.tsx': 1,
  'src/screens/stack/ProviderCreateScreen.tsx': 1,
  'src/screens/tabs/chat-tab/useChatTabMessageActions.ts': 1,
  'src/services/agent-run.service.ts': 1,
  'src/services/chat-prompt-tokens.service.ts': 10,
  'src/services/chat-transcript-telemetry.ts': 1,
  'src/services/cloud-sync-progress-log.ts': 1,
  'src/services/llm-native-fetch-shim.ts': 1,
  'src/services/run-state-writethrough.ts': 1,
  'src/services/session-prompt-input.service.ts': 5,
  'src/services/session-stream-unit-manager.service.ts': 10,
  'src/services/session-stream-unit.ts': 5,
  'src/services/vfs-operations.service.ts': 1,
  'src/storage/app-ui-pref-io.ts': 1,
  'src/storage/chat-composer-draft.ts': 1,
  'src/theme/ThemeProvider.tsx': 1,
};

/** 业务文件（白名单之外）裸 console 总预算（§7.3 实测 45 处）。 */
const BUSINESS_BUDGET = 45;

const RAW_CONSOLE = /console\.(log|info|warn|error|debug|trace)\(/g;

/** 递归收集 src 下的 .ts/.tsx。 */
function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** 实际命中表：`src/...` 相对路径 → 裸 console 计数。 */
function readActualCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const full of collectSourceFiles(SRC_ROOT)) {
    const key = `src/${relative(SRC_ROOT, full).replace(/\\/g, '/')}`;
    // src/web 不在 E6 扫描面（web bundle 无 logger 依赖，见 §7.3）。
    if (key.startsWith('src/web/')) {
      continue;
    }
    const count = (readFileSync(full, 'utf8').match(RAW_CONSOLE) ?? []).length;
    if (count > 0) {
      counts.set(key, count);
    }
  }
  return counts;
}

const actual = readActualCounts();
const baseline = {...WHITELIST_BASELINE, ...BUSINESS_BASELINE};

describe('全仓裸 console 基线不增长（spec C31）', () => {
  it('扫描面非空且命中全部落在基线文件集合内（新增文件即红）', () => {
    expect(actual.size).toBeGreaterThan(0);
    for (const file of actual.keys()) {
      expect(Object.prototype.hasOwnProperty.call(baseline, file)).toBe(true);
    }
  });

  it('每个基线文件的裸 console 计数只允许下降（不允许上升）', () => {
    for (const [file, count] of actual) {
      expect(count).toBeLessThanOrEqual(baseline[file]);
    }
  });

  it('白名单计数只允许下降（去白名单化需同步改本表）', () => {
    for (const [file, count] of Object.entries(WHITELIST_BASELINE)) {
      expect(actual.get(file) ?? 0).toBeLessThanOrEqual(count);
    }
  });

  it('业务文件裸 console 总数不超过 45 处（本轮收口后实际 30 处）', () => {
    let total = 0;
    for (const [file, count] of actual) {
      if (!(file in WHITELIST_BASELINE)) {
        total += count;
      }
    }
    expect(total).toBeLessThanOrEqual(BUSINESS_BUDGET);
  });
});
