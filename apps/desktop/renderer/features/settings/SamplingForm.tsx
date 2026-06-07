import { useMemo } from "react";
import {
  mergeSamplingWithDefaults,
  type LlmProtocolKind,
  type ModelSamplingParams,
} from "@novel-master/core";
import { SettingsField } from "./settings-ui";

type SamplingFormProps = {
  protocol: LlmProtocolKind;
  params: ModelSamplingParams | undefined;
  onChange: (params: ModelSamplingParams | undefined) => void;
};

function numStr(value: number | undefined): string {
  return value != null ? String(value) : "";
}

function parseNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function patchOpenAi(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams {
  const base = prev?.protocol === "openai" ? { ...prev.openai } : {};
  return {
    protocol: "openai",
    openai: { ...base, ...patch },
  };
}

function patchAnthropic(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams {
  const base = prev?.protocol === "anthropic" ? { ...prev.anthropic } : {};
  return {
    protocol: "anthropic",
    anthropic: { ...base, ...patch },
  };
}

function patchGemini(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams {
  const base = prev?.protocol === "gemini" ? { ...prev.gemini } : {};
  return {
    protocol: "gemini",
    gemini: { ...base, ...patch },
  };
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SettingsField label={label}>
      <input type="number" step="any" value={value} onChange={(e) => onChange(e.target.value)} />
    </SettingsField>
  );
}

export function SamplingForm({ protocol, params, onChange }: SamplingFormProps) {
  const effective = useMemo(
    () => mergeSamplingWithDefaults(protocol, params),
    [protocol, params],
  );
  const openai = effective.protocol === "openai" ? effective.openai : {};
  const anthropic = effective.protocol === "anthropic" ? effective.anthropic : {};
  const gemini = effective.protocol === "gemini" ? effective.gemini : {};

  if (protocol === "openai") {
    return (
      <>
        <NumberField
          label="温度"
          value={numStr(openai.temperature)}
          onChange={(v) => onChange(patchOpenAi(params, { temperature: parseNumber(v) }))}
        />
        <NumberField
          label="Top P"
          value={numStr(openai.top_p)}
          onChange={(v) => onChange(patchOpenAi(params, { top_p: parseNumber(v) }))}
        />
        <NumberField
          label="输出最大长度"
          value={numStr(openai.max_tokens)}
          onChange={(v) => onChange(patchOpenAi(params, { max_tokens: parseNumber(v) }))}
        />
      </>
    );
  }

  if (protocol === "anthropic") {
    return (
      <>
        <NumberField
          label="温度"
          value={numStr(anthropic.temperature)}
          onChange={(v) => onChange(patchAnthropic(params, { temperature: parseNumber(v) }))}
        />
        <NumberField
          label="Top P"
          value={numStr(anthropic.top_p)}
          onChange={(v) => onChange(patchAnthropic(params, { top_p: parseNumber(v) }))}
        />
        <NumberField
          label="Top K"
          value={numStr(anthropic.top_k)}
          onChange={(v) => onChange(patchAnthropic(params, { top_k: parseNumber(v) }))}
        />
        <NumberField
          label="输出最大长度"
          value={numStr(anthropic.max_tokens)}
          onChange={(v) => onChange(patchAnthropic(params, { max_tokens: parseNumber(v) }))}
        />
      </>
    );
  }

  return (
    <>
      <NumberField
        label="温度"
        value={numStr(gemini.temperature)}
        onChange={(v) => onChange(patchGemini(params, { temperature: parseNumber(v) }))}
      />
      <NumberField
        label="Top P"
        value={numStr(gemini.topP)}
        onChange={(v) => onChange(patchGemini(params, { topP: parseNumber(v) }))}
      />
      <NumberField
        label="Top K"
        value={numStr(gemini.topK)}
        onChange={(v) => onChange(patchGemini(params, { topK: parseNumber(v) }))}
      />
      <NumberField
        label="输出最大长度"
        value={numStr(gemini.maxOutputTokens)}
        onChange={(v) =>
          onChange(patchGemini(params, { maxOutputTokens: parseNumber(v) }))
        }
      />
    </>
  );
}
