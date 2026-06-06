import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  active?: boolean;
};

export function IconButton({
  label,
  children,
  active,
  className,
  ...rest
}: IconButtonProps) {
  const merged = [
    "icon-btn",
    active ? "is-active" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={merged} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}
