/**
 * 设置 · 搜索配置列表页（两级结构第一级）：
 * 行清单完全来自 `SearchConfigDto.engines`（core 按 engineOrderV2 归一：六预置 +
 * 自定义实例 + DDG，顺序即串行降级链优先级）。每行 = 名称 + 状态标签 +
 * 启用开关 + ⋮ 菜单（上移/下移调整优先级，自定义引擎另有删除）；点击行进入
 * 单引擎详情页；页首「新建自定义引擎」进详情页 create 模式（复用
 * `searchEngineDetail` viewId + `editingEngineId` 哨兵，不新增 viewId）。
 * 详细说明收进页首「?」按钮的帮助弹窗，页内不再铺长文案（双端同构口径）。
 */
import { useCallback, useEffect, useState } from "react";
import type { IpcResult, SearchConfigDto, SearchEngineStatusDto } from "@shared/ipc-types";
import {
  ipcSearchDeleteCustomEngine,
  ipcSearchGetConfig,
  ipcSearchSetEnabled,
  ipcSearchSetEngineOrder,
} from "@/ipc/client";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { Switch } from "@/components/ui/Switch";
import { toastSettingsSuccess } from "@/utils/settings-feedback";
import type { SettingsNavHandle } from "./settings-nav";
import { ENGINE_META, NEW_ENGINE_SENTINEL } from "./search-engine-meta";
import {
  BuiltinEngineTag,
  SettingsListSection,
  SettingsPanel,
  SettingsStatus,
} from "./settings-ui";

/**
 * 帮助弹窗分段口径：以 mobile `SearchEnginesScreen.tsx` 帮助弹窗为真源逐字
 * 同步（五段，勿漂移）；「模板与自定义引擎」段按 SPEC v2 透传改造简化
 * （不再提响应映射与高级区，保留 curl 导入 / 占位符 / defaultBody 可选口径），
 * count 措辞按 FIX-26 定稿（整数字段带引号），W6 同步改 mobile 同句后双端统一。
 */
const HELP_SECTIONS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "启用开关",
    body: "只有打开开关的引擎参与搜索；默认仅内置 DuckDuckGo 启用。关闭全部引擎后搜索会返回提示，不会偷偷兜底。",
  },
  {
    title: "引擎优先级",
    body: "列表顺序即搜索时尝试引擎的顺序；请求失败（如密钥失效、超时）自动尝试下一个已启用且配置完整的引擎。",
  },
  {
    title: "模板与自定义引擎",
    body: "预置引擎的请求模板可在详情页编辑并恢复默认；也可新建自定义引擎，粘贴 curl 命令导入，用模板描述任意搜索 API（支持 {{query}}/{{count}}/{{apiKey}}/{{baseUrl}} 占位符）。请求体 defaultBody 可选，留空则由 agent 调用时传参；占位符写在字符串值里；整数字段写 \"{{count}}\"（带引号），执行时自动转为数字。",
  },
  {
    title: "测试消耗配额",
    body: "详情页的「测试搜索」会真实请求引擎接口，可能消耗引擎配额或产生计费。",
  },
  {
    title: "密钥安全",
    body: "API key 仅存本机安全密钥库，不进入会话记录，不随云同步上传。",
  },
];

// nm-style: keep-local — 单点展示组件承载帮助弹窗的 overlay/dialog 边界与
// aria 语义；内联进列表 JSX 会拆散弹窗结构（20+ 行纯展示 markup）
function SearchHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="text-prompt-overlay" onClick={onClose}>
      <div className="text-prompt-modal text-prompt-modal--wide" role="dialog" aria-modal="true" aria-labelledby="search-help-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="search-help-title" className="text-prompt-modal__title">
          使用说明
        </h3>
        {HELP_SECTIONS.map((section) => (
          <p key={section.title} className="settings-hint">
            <strong>{section.title}：</strong>
            {section.body}
          </p>
        ))}
        <div className="confirm-modal__actions">
          <Button variant="primary" onClick={onClose}>
            知道了
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SearchEnginesView({ nav }: { nav: SettingsNavHandle }) {
  const [config, setConfig] = useState<SearchConfigDto | null>(null);
  const [menu, setMenu] = useState<{ engineId: string; x: number; y: number } | null>(null);
  /** 排序 / 开关 / 删除在途（行控件整体禁点，避免交错提交）。 */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [helpOpen, setHelpOpen] = useState(false);
  /** 待确认删除的自定义引擎（null = 无）。 */
  const [deleteTarget, setDeleteTarget] = useState<SearchEngineStatusDto | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const res = await ipcSearchGetConfig();
    if (res.ok) setConfig(res.data);
    else setError(res.error.message);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runWrite = async (action: () => Promise<IpcResult<void>>, success?: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      await reload();
      if (success != null) toastSettingsSuccess(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 上移/下移：与相邻引擎交换后提交完整顺序（动态 id 全集，缺项由 core 读侧补齐）。 */
  const moveEngine = (engine: SearchEngineStatusDto, dir: -1 | 1) => {
    if (config == null) return;
    const order = config.engines.map((engine) => engine.id);
    const index = order.indexOf(engine.id);
    const target = index + dir;
    // 越界双保险：菜单项已禁用，此处再挡一次绕过 UI 的调用
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    void runWrite(() => ipcSearchSetEngineOrder({ engineOrder: next }));
  };

  // nm-style: keep-local — 删除失败也要收起确认框（错误经页内 SettingsStatus 展示），
  // 共享 busy 互斥态、回读与 toast；内联进 ConfirmModal onConfirm 会拆散收框不变量
  const removeEngine = async (): Promise<void> => {
    if (deleteTarget == null) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await ipcSearchDeleteCustomEngine({ engineId: deleteTarget.id });
      // 失败也收起确认框：错误经页内 SettingsStatus 展示，避免弹窗挡住原因
      setDeleteTarget(null);
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      await reload();
      toastSettingsSuccess("已删除");
    } catch (e) {
      setDeleteTarget(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const order = config?.engines.map((engine) => engine.id) ?? [];

  return (
    <SettingsPanel>
      <SettingsListSection
        header={
          <div className="settings-toolbar settings-toolbar--end">
            <Button variant="secondary" disabled={busy} onClick={() => { nav.navState.editingEngineId = NEW_ENGINE_SENTINEL; nav.push("searchEngineDetail"); }}>
              新建自定义引擎
            </Button>
            <button type="button" className="icon-btn" aria-label="使用说明" onClick={() => setHelpOpen(true)}>
              ?
            </button>
          </div>
        }
      >
        {config == null && error == null ? <p className="settings-hint">加载中…</p> : null}
        {(config?.engines ?? []).map((engine) => (
          <div key={engine.id} className="settings-list-item-row">
            <button
              type="button"
              className="settings-list-item"
              onClick={() => {
                nav.navState.editingEngineId = engine.id;
                nav.push("searchEngineDetail");
              }}
            >
              <span className="settings-list-item__label">
                {engine.name}
                {engine.isCustom || ENGINE_META[engine.id] == null ? null : <span className="settings-row__desc">{ENGINE_META[engine.id]?.desc}</span>}
              </span>
              <span className="settings-list-item__meta">
                {engine.id === "duckduckgo" ? <BuiltinEngineTag /> : null}
                {engine.isCustom ? <span className="settings-tag settings-tag--muted">自定义</span> : null}
                {engine.needsKey && !engine.hasKey ? <span className="settings-tag settings-tag--warn">未设密钥</span> : null}
                {engine.needsBaseUrl && engine.baseUrl == null ? <span className="settings-tag settings-tag--warn">未设实例地址</span> : null}
                {!engine.isCustom && engine.id !== "duckduckgo" && (!engine.needsKey || engine.hasKey) && (!engine.needsBaseUrl || engine.baseUrl != null) ? <span className="settings-tag settings-tag--ok">已配置</span> : null}
              </span>
              <span className="settings-list-item__chevron" aria-hidden="true">
                ›
              </span>
            </button>
            <span className="settings-list-item__switch">
              <Switch checked={engine.enabled} disabled={busy} onChange={(next) => void runWrite(() => ipcSearchSetEnabled({ engineId: engine.id, enabled: next }))} aria-label={`启用 ${engine.name}`} />
            </span>
            <button
              type="button"
              className="settings-list-item__menu-btn"
              aria-label={`更多 ${engine.name}`}
              onClick={(e) => {
                if (busy) return;
                const rect = e.currentTarget.getBoundingClientRect();
                setMenu({ engineId: engine.id, x: Math.max(8, rect.left), y: Math.max(8, rect.bottom + 4) });
              }}
            >
              ⋮
            </button>
          </div>
        ))}
      </SettingsListSection>
      <SettingsStatus error={error} />
      <ContextMenu
        open={menu != null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={
          menu == null
            ? []
            : [
                { label: "上移", action: "up", disabled: order.indexOf(menu.engineId) === 0 || busy },
                { label: "下移", action: "down", disabled: order.indexOf(menu.engineId) === order.length - 1 || busy },
                ...(config?.engines.find((engine) => engine.id === menu.engineId)?.isCustom === true ? [{ label: "删除", action: "delete", danger: true }] : []),
              ]
        }
        onSelect={(action) => {
          const engine = config?.engines.find((item) => item.id === menu?.engineId);
          if (engine == null) return;
          if (action === "up") moveEngine(engine, -1);
          if (action === "down") moveEngine(engine, 1);
          if (action === "delete") setDeleteTarget(engine);
        }}
        onClose={() => setMenu(null)}
      />
      <ConfirmModal
        open={deleteTarget != null}
        title="删除自定义引擎"
        message={`确定删除「${deleteTarget?.name ?? ""}」吗？其密钥与本机保存的实例地址会一并清除。`}
        confirmLabel="删除"
        danger
        busy={busy}
        onConfirm={() => void removeEngine()}
        onCancel={() => setDeleteTarget(null)}
      />
      {helpOpen ? <SearchHelpModal onClose={() => setHelpOpen(false)} /> : null}
    </SettingsPanel>
  );
}
