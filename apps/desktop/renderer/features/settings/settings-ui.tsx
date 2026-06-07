import type { ReactNode } from "react";
import { Switch } from "../../components/ui/Switch";
import { BatchCheckbox } from "../../components/batch/BatchCheckbox";

export function SettingsPanel({ children }: { children: ReactNode }) {
  return <div className="settings-panel">{children}</div>;
}

export function SettingsSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-section">
      <h3 className="settings-section__title">{title}</h3>
      {desc ? <p className="settings-section__desc">{desc}</p> : null}
      {children}
    </section>
  );
}

export function SettingsRows({ children }: { children: ReactNode }) {
  return <div className="settings-rows">{children}</div>;
}

export function SettingsRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="settings-row" onClick={onClick}>
      <span className="settings-row__label">{label}</span>
      <span className="settings-row__value">{value}</span>
      <span className="settings-row__chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

export function SettingsSwitchRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="settings-row settings-row--switch">
      <span className="settings-row__label">{label}</span>
      <Switch checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

export function SettingsListSection({
  header,
  children,
  empty,
}: {
  header?: ReactNode;
  children: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <section className="settings-section settings-section--list">
      {header ? <div className="settings-toolbar">{header}</div> : null}
      <div className="settings-list">
        {empty}
        {children}
      </div>
    </section>
  );
}

export function SettingsToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `settings-toolbar ${className}` : "settings-toolbar"}>
      {children}
    </div>
  );
}

export function SettingsListItem({
  title,
  meta,
  onClick,
  onMenu,
  batchMode = false,
  selected = false,
  onToggleSelect,
}: {
  title: string;
  meta?: string;
  onClick?: () => void;
  onMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  batchMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const handleClick = () => {
    if (batchMode) {
      onToggleSelect?.();
      return;
    }
    onClick?.();
  };

  const itemButton = (
    <button
      type="button"
      className={`settings-list-item${selected ? " is-selected" : ""}`}
      onClick={handleClick}
    >
      {batchMode ? (
        <BatchCheckbox
          checked={selected}
          onToggle={() => onToggleSelect?.()}
        />
      ) : null}
      <span className="settings-list-item__label">{title}</span>
      {meta ? <span className="settings-list-item__meta">{meta}</span> : null}
      {!batchMode ? (
        <span className="settings-list-item__chevron" aria-hidden="true">
          ›
        </span>
      ) : null}
    </button>
  );

  if (!onMenu || batchMode) {
    return itemButton;
  }

  return (
    <div className="settings-list-item-row">
      {itemButton}
      <button
        type="button"
        className="settings-list-item__menu-btn"
        aria-label="更多"
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e);
        }}
      >
        ⋮
      </button>
    </div>
  );
}

export function SettingsFormSection({
  title,
  desc,
  toolbar,
  children,
  footer,
}: {
  title: string;
  desc?: string;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="settings-section settings-section--form">
      <div className="settings-form-header">
        <h3 className="settings-section__title">{title}</h3>
        {toolbar ? <div className="settings-form-toolbar">{toolbar}</div> : null}
      </div>
      {desc ? <p className="settings-section__desc">{desc}</p> : null}
      <div className="settings-fields">{children}</div>
      {footer ? <div className="settings-section__footer">{footer}</div> : null}
    </section>
  );
}

export function SettingsField({
  label,
  children,
  narrow,
}: {
  label: string;
  children: ReactNode;
  narrow?: boolean;
}) {
  return (
    <label className={`settings-field${narrow ? " settings-field--narrow" : ""}`}>
      <span className="settings-field__label">{label}</span>
      {children}
    </label>
  );
}

export function SettingsActionSection({
  title,
  desc,
  action,
}: {
  title: string;
  desc: string;
  action: ReactNode;
}) {
  return (
    <section className="settings-section settings-section--action">
      <h3 className="settings-section__title">{title}</h3>
      <p className="settings-section__desc">{desc}</p>
      {action}
    </section>
  );
}

export function SettingsStatus({
  message,
  error,
  inline,
}: {
  message?: string;
  error?: string;
  inline?: boolean;
}) {
  if (!message && !error) return null;
  return (
    <p
      className={`settings-status${inline ? " settings-status--inline" : ""}`}
      style={{ color: error ? "var(--danger, #c00)" : undefined }}
    >
      {error ?? message}
    </p>
  );
}

export function SettingsListEmpty({ children }: { children: ReactNode }) {
  return <p className="settings-list__empty">{children}</p>;
}
