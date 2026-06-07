type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

/** Slider switch aligned with prototype `settings-switch` markup. */
export function Switch({
  checked,
  onChange,
  id,
  disabled = false,
  "aria-label": ariaLabel,
}: SwitchProps) {
  return (
    <label className={`settings-switch${disabled ? " is-disabled" : ""}`}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settings-switch-slider" aria-hidden="true" />
    </label>
  );
}
