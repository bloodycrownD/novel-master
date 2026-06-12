import { useMemo, useState } from "react";
import { BUILTIN_TOOL_CATALOG } from "@novel-master/core/config-forms/agent";
import { BatchCheckbox } from "../../components/batch/BatchCheckbox";

type Props = {
  selected: readonly string[];
  onChange: (selected: string[]) => void;
};

export function ToolPolicyPicker({ selected, onChange }: Props) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") {
      return BUILTIN_TOOL_CATALOG;
    }
    return BUILTIN_TOOL_CATALOG.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }, [query]);

  const toggle = (name: string) => {
    if (selectedSet.has(name)) {
      onChange(selected.filter((n) => n !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  const remove = (name: string) => {
    onChange(selected.filter((n) => n !== name));
  };

  return (
    <div className="tool-policy-picker">
      {selected.length > 0 ? (
        <div className="config-dep-chips tool-policy-picker__selected">
          {selected.map((name) => (
            <button
              key={name}
              type="button"
              className="config-dep-chip is-active"
              onClick={() => remove(name)}
              title="移除"
            >
              {name} ×
            </button>
          ))}
        </div>
      ) : null}
      <input
        type="search"
        className="tool-policy-picker__search"
        placeholder="搜索工具…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="tool-policy-picker__list">
        {filtered.map((item) => {
          const checked = selectedSet.has(item.name);
          return (
            <button
              key={item.name}
              type="button"
              className="tool-policy-picker__row"
              onClick={() => toggle(item.name)}
            >
              <BatchCheckbox checked={checked} onToggle={() => toggle(item.name)} />
              <span className="tool-policy-picker__name">{item.name}</span>
              <span className="tool-policy-picker__desc">{item.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
