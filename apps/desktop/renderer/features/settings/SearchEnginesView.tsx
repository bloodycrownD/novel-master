/**
 * 设置 · 搜索配置列表页（两级结构第一级）：
 * 每行 = 引擎名（按 engineOrder 优先级序）+ 配置状态标签 + ⋮ 菜单
 * （上移/下移调整串行降级链顺序，首位的「上移」与末位的「下移」
 * 禁用）；点击行进入单引擎详情页。排序即优先级：search 工具按
 * engineOrder 顺序串行降级请求。
 */
import { useCallback, useEffect, useState } from "react";
import { ENGINE_IDS, type EngineId } from "@shared/logic/search-engines";
import type { SearchConfigDto } from "@shared/ipc-types";
import { ipcSearchGetConfig, ipcSearchSetEngineOrder } from "@/ipc/client";
import { ContextMenu } from "@/components/ui/ContextMenu";
import type { SettingsNavHandle } from "./settings-nav";
import { ENGINE_META } from "./search-engine-meta";
import {
  ApiKeyStatusTag,
  SettingsListItem,
  SettingsListSection,
  SettingsPanel,
} from "./settings-ui";

export function SearchEnginesView({ nav }: { nav: SettingsNavHandle }) {
  const [config, setConfig] = useState<SearchConfigDto | null>(null);
  const [menu, setMenu] = useState<{
    engineId: EngineId;
    x: number;
    y: number;
  } | null>(null);
  /** 排序 IPC 在途（菜单项整体禁点，避免交错提交错序排列）。 */
  const [reordering, setReordering] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const reload = useCallback(async (): Promise<void> => {
    const res = await ipcSearchGetConfig();
    if (res.ok) {
      setConfig(res.data);
    } else {
      setError(res.error.message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 上移/下移：与相邻引擎交换后提交完整 engineOrder，再重读刷新。 */
  const moveEngine = async (engineId: EngineId, dir: -1 | 1) => {
    if (config == null || reordering) return;
    const order = [...config.engineOrder];
    const index = order.indexOf(engineId);
    const target = index + dir;
    // 越界双保险：菜单项已禁用，此处再挡一次绕过 UI 的调用
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setReordering(true);
    setError(undefined);
    try {
      const res = await ipcSearchSetEngineOrder({ engineOrder: next });
      if (res.ok) {
        await reload();
      } else {
        setError(res.error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReordering(false); // 异常也不残留互斥态
    }
  };

  const handleMenuSelect = (action: string) => {
    const target = menu;
    setMenu(null);
    if (target == null) return;
    if (action === "up") void moveEngine(target.engineId, -1);
    if (action === "down") void moveEngine(target.engineId, 1);
  };

  // 行序 = engineOrder（core 读取时已容错归一为四引擎全排列）
  const order: readonly EngineId[] = config?.engineOrder ?? [...ENGINE_IDS];

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <p className="settings-hint">
            为 search 工具配置搜索引擎：点击条目配置 API Key / 实例地址；
            ⋮ 菜单上下移动调整优先级（search 按此顺序串行降级请求）。
          </p>
        }
      >
        {config == null && error == null ? (
          <SettingsListItem title="加载中…" />
        ) : null}
        {order.map((engineId) => {
          const meta = ENGINE_META[engineId];
          const configured = config?.engines[engineId]?.configured ?? false;
          return (
            <SettingsListItem
              key={engineId}
              title={meta.label}
              meta={<ApiKeyStatusTag status={configured ? "set" : "not set"} />}
              onClick={() => {
                nav.navState.editingEngineId = engineId;
                nav.push("searchEngineDetail");
              }}
              onMenu={(e) => {
                if (reordering) return;
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({
                  engineId,
                  x: Math.max(8, rect.left),
                  y: Math.max(8, rect.bottom + 4),
                });
              }}
            />
          );
        })}
      </SettingsListSection>
      {error ? <p className="settings-error">{error}</p> : null}
      <ContextMenu
        open={menu != null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={
          menu == null
            ? []
            : [
                {
                  label: "上移",
                  action: "up",
                  // 首位引擎的上移禁用（已在链首）
                  disabled:
                    order.indexOf(menu.engineId) === 0 || reordering,
                },
                {
                  label: "下移",
                  action: "down",
                  // 末位引擎的下移禁用（已在链尾）
                  disabled:
                    order.indexOf(menu.engineId) === order.length - 1 ||
                    reordering,
                },
              ]
        }
        onSelect={handleMenuSelect}
        onClose={() => setMenu(null)}
      />
    </SettingsPanel>
  );
}
