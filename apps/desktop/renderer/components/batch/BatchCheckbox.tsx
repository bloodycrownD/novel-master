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
      aria-label={checked ? "取消选择" : "选择"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {checked ? "✓" : null}
    </button>
  );
}
