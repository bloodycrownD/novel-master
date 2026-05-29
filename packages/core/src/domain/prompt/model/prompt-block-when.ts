/**
 * Declarative prompt block visibility conditions.
 *
 * @module domain/prompt/model/prompt-block-when
 */

/** `present` / `absent` dot field guard (no free expressions). */
export type PromptBlockWhen =
  | { readonly present: string }
  | { readonly absent: string };

/**
 * Evaluates a block `when` clause against dot context.
 * `present: abstract` is true when dot.abstract is a non-empty trimmed string.
 */
export function evaluatePromptBlockWhen(
  when: PromptBlockWhen,
  dot: Readonly<Record<string, unknown>>,
): boolean {
  const field =
    "present" in when ? when.present : "absent" in when ? when.absent : "";
  const value = dot[field];
  const nonEmpty =
    typeof value === "string" && value.trim().length > 0;

  if ("present" in when) {
    return nonEmpty;
  }
  return !nonEmpty;
}
