import type { TextareaHTMLAttributes } from "react";

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Monospace font for code / config editing. */
  code?: boolean;
  /** Fill remaining flex space (borderless, for editor shells). */
  fill?: boolean;
};

export function TextArea({
  code = false,
  fill = false,
  className,
  ...rest
}: TextAreaProps) {
  const classes = [
    "ui-textarea",
    code ? "ui-textarea--code" : null,
    fill ? "ui-textarea--fill" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <textarea className={classes} {...rest} />;
}
