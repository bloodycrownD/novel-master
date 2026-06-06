type SwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  id?: string;
  "aria-label"?: string;
};

/** Slider switch aligned with prototype `settings-switch` markup. */
export function Switch({ checked, onChange, id, "aria-label": ariaLabel }: SwitchProps) {
  return (
    <label className="settings-switch">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settings-switch-slider" aria-hidden="true" />
    </label>
  );
}
