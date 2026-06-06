import type { ReactNode } from "react";

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
    <label className="settings-row settings-row--switch">
      <span className="settings-row__label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

export function SettingsListSection({
  header,
  children,
}: {
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-section settings-section--list">
      {header ? <div className="settings-section__actions">{header}</div> : null}
      <div className="settings-list">{children}</div>
    </section>
  );
}

export function SettingsListItem({
  title,
  meta,
  onClick,
  onMenu,
}: {
  title: string;
  meta?: string;
  onClick?: () => void;
  onMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="settings-list-item">
      <button type="button" className="settings-list-item__main" onClick={onClick}>
        <span className="settings-list-item__title">{title}</span>
        {meta ? <span className="settings-list-item__meta">{meta}</span> : null}
      </button>
      {onMenu ? (
        <button
          type="button"
          className="settings-list-item__menu"
          aria-label="更多"
          onClick={(e) => {
            e.stopPropagation();
            onMenu(e);
          }}
        >
          ⋯
        </button>
      ) : null}
    </div>
  );
}

export function SettingsFormSection({
  title,
  desc,
  children,
  footer,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="settings-section settings-section--form">
      <h3 className="settings-section__title">{title}</h3>
      {desc ? <p className="settings-section__desc">{desc}</p> : null}
      <div className="settings-fields">{children}</div>
      {footer ? <div className="settings-section__footer">{footer}</div> : null}
    </section>
  );
}

export function SettingsField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="settings-field">
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

export function SettingsStatus({ message, error }: { message?: string; error?: string }) {
  if (!message && !error) return null;
  return (
    <p
      className="settings-status"
      style={{ color: error ? "var(--danger, #c00)" : "var(--text-secondary)" }}
    >
      {error ?? message}
    </p>
  );
}
