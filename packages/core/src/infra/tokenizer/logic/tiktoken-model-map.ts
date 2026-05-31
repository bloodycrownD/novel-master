/**
 * Maps vendor model id substrings to tiktoken `encoding_for_model` names.
 *
 * L2 table: ordered longest-first; only used when provider protocol is openai.
 *
 * @module infra/tokenizer/logic/tiktoken-model-map
 */

/** Tiktoken model name passed to `encoding_for_model`. */
export function mapVendorModelIdToTiktokenModel(vendorModelId: string): string {
  const id = vendorModelId.toLowerCase();

  if (id.includes("gpt-3.5-turbo-0301")) {
    return "gpt-3.5-turbo-0301";
  }
  if (id.includes("gpt-4o") || id.includes("chatgpt-4o")) {
    return "gpt-4o";
  }
  if (id.includes("gpt-4.1") || id.includes("gpt-4.5")) {
    return "gpt-4o";
  }
  if (id.includes("gpt-4-32k")) {
    return "gpt-4-32k";
  }
  if (
    id.includes("o1-preview") ||
    id.includes("o1-mini") ||
    id.includes("o3-mini") ||
    id.includes("o4-mini")
  ) {
    return "o1";
  }
  if (hasStandaloneToken(id, "o1") || hasStandaloneToken(id, "o3")) {
    return "o1";
  }
  if (id.includes("gpt-4")) {
    return "gpt-4";
  }
  if (id.includes("gpt-3.5-turbo")) {
    return "gpt-3.5-turbo";
  }

  // OpenAI protocol but no gpt/o substring — default turbo encoding (see SPEC).
  return "gpt-3.5-turbo";
}

/** True when model id uses the 0301 per-message overhead variant. */
export function isGpt0301TiktokenModel(tiktokenModel: string): boolean {
  return tiktokenModel === "gpt-3.5-turbo-0301";
}

function hasStandaloneToken(id: string, token: string): boolean {
  const idx = id.indexOf(token);
  if (idx < 0) {
    return false;
  }
  const before = idx === 0 ? "" : id[idx - 1]!;
  const after = id[idx + token.length] ?? "";
  const boundary = /[^a-z0-9-]/;
  const beforeOk = idx === 0 || boundary.test(before);
  const afterOk = after === "" || boundary.test(after);
  return beforeOk && afterOk;
}
