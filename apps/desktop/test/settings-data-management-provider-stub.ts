/**
 * DataManagementView 取消入口测试的 NovelMasterProvider 替身。
 *
 * 真实 Provider 挂载即走 bootstrap IPC 并渲染 loading，拿不到设置页子树；
 * 本 view 只消费 retry（导入/拉取成功后刷新），替身保持同形即可。
 */
export function useNovelMaster() {
    return {
        status: "ready" as const,
        dbPath: undefined,
        error: undefined,
        retry: () => {},
    };
}
