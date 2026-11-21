import { coreT } from "@shared/logic/core-i18n";

type BatchCheckboxProps = {
  checked: boolean;
  onToggle: () => void;
};

export function BatchCheckbox({ checked, onToggle }: BatchCheckboxProps) {
  return (
    <button
      type="button"
      className={`batch-check${checked ? " checked" : ""}`}
      aria-checked={checked}
      aria-label={checked ? coreT({key: "ui.common.deselect"}) : coreT({key: "ui.common.select"})}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {checked ? "✓" : null}
    </button>
  );
}
