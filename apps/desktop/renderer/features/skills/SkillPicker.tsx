/**
 * `$` 引用技能选择器（composer 工具栏按钮入口）：平铺列表，非层级浏览器。
 *
 * 合并视图（同名项目副本覆盖、标覆盖）；无效技能不出现；
 * 已关闭技能可选但标注关闭态（显式引用优先于负清单，PRD 拍板）。
 * 形态对齐 FileReferencePicker 弹层（多选 + 确认插入 token）。
 */
import { useCallback, useEffect, useState } from "react";
import type { EffectiveSkillDto } from "@shared/ipc-types";
import { ipcSkillsEffective } from "@/ipc/client";
import { skillDomainLabel } from "./skill-ui";

export type SkillPickerProps = {
  open: boolean;
  projectId: string;
  onClose: () => void;
  /** 确认后插入正文的 `$技能名` token 列表。 */
  onConfirm: (skillTokens: string[]) => void;
};

export function SkillPicker({
  open,
  projectId,
  onClose,
  onConfirm,
}: SkillPickerProps) {
  const [rows, setRows] = useState<EffectiveSkillDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    const res = await ipcSkillsEffective({ projectId });
    setLoading(false);
    if (!res.ok) {
      setError(res.error.message);
      setRows([]);
      return;
    }
    // 无效技能不进入选择器（手打 token 仍可引用，由 hydrate 容错）
    setRows(res.data.filter((row) => row.valid));
  }, [projectId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelected(new Set());
    void load();
  }, [open, projectId, load]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  if (!open) {
    return null;
  }

  return (
    <div className="file-ref-picker" role="dialog" aria-modal="true">
      <div className="file-ref-picker__backdrop" onClick={onClose} />
      <div className="file-ref-picker__panel">
        <header className="file-ref-picker__head">
          <h3>引用技能</h3>
          <p className="file-ref-picker__hint">
            平铺当前项目合并视图，可多选；已关闭的技能仍会注入全文
          </p>
        </header>
        {error ? <p className="file-ref-picker__error">{error}</p> : null}
        <ul className="file-ref-picker__list">
          {loading ? <li className="file-ref-picker__empty">加载中…</li> : null}
          {!loading && rows.length === 0 ? (
            <li className="file-ref-picker__empty">暂无可用技能</li>
          ) : null}
          {rows.map((row) => {
            const checked = selected.has(row.name);
            return (
              <li key={row.name}>
                <div
                  className={`file-ref-picker__row file-ref-picker__row--split${
                    checked ? " is-selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="file-ref-picker__check"
                    aria-label={`选用技能 ${row.name}`}
                    aria-pressed={checked}
                    onClick={() => toggle(row.name)}
                  >
                    <span aria-hidden>{checked ? "☑" : "☐"}</span>
                  </button>
                  <button
                    type="button"
                    className="file-ref-picker__enter skill-picker__row"
                    aria-label={`选用技能 ${row.name}`}
                    onClick={() => toggle(row.name)}
                  >
                    <span className="skill-picker__name">{row.name}</span>
                    <span className="skill-picker__meta">
                      <span className="skill-domain-badge">
                        {skillDomainLabel(row.domain, row.overridden)}
                      </span>
                      {row.disabled ? (
                        <span className="skill-picker__off">已关闭</span>
                      ) : null}
                      {row.description ?? ""}
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        <footer className="file-ref-picker__foot">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="file-ref-picker__confirm"
            disabled={selected.size === 0}
            onClick={() => {
              onConfirm([...selected].map((name) => `$${name}`));
              onClose();
            }}
          >
            确认
          </button>
        </footer>
      </div>
    </div>
  );
}
