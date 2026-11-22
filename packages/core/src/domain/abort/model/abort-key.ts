/**
 * 取消注册表的 key 工厂：两端共用同一套字符串，registry 实例各进程独立，
 * 字符串相同不冲突。id 取值规则见 signal-abort-scope spec §二（桌面 runId、
 * 移动固定 `"local"`）。
 *
 * @module domain/abort/model/abort-key
 */

/** key 命名空间。 */
export const ABORT_KEY = {
    agent: (sessionId: string) => `agent:${sessionId}`,
    run: (runId: string) => `run:${runId}`,
    backup: (runId: string) => `backup:${runId}`,
    dbMaintenance: (runId: string) => `dbmaint:${runId}`,
    usageStats: (runId: string) => `stats:${runId}`,
    providerModels: (providerId: string) => `models:${providerId}`,
    cloudSync: (id: string) => `sync:${id}`,
    compaction: (sessionId: string) => `compaction:${sessionId}`,
} as const;
