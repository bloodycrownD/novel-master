/**
 * Protocol-specific model sampling fields (openai / anthropic / gemini).
 */
import React from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import type {
  LlmProtocolKind,
  ModelSamplingParams,
} from '@novel-master/core';
import {useTheme} from '../../theme/ThemeProvider';

type Props = {
  protocol: LlmProtocolKind;
  params: ModelSamplingParams | undefined;
  onChange: (params: ModelSamplingParams | undefined) => void;
};

function numStr(value: number | undefined): string {
  return value != null ? String(value) : '';
}

function parseOptionalNumber(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function NumberField({
  label,
  value,
  onChangeText,
  step = '1',
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  step?: string;
}) {
  const {tokens} = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, {color: tokens.textSecondary}]}>{label}</Text>
      <TextInput
        style={[styles.input, {color: tokens.text, borderColor: tokens.border}]}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholder="可选"
        placeholderTextColor={tokens.textSecondary}
      />
    </View>
  );
}

function patchOpenAi(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams | undefined {
  const base = prev?.protocol === 'openai' ? {...prev.openai} : {};
  const merged = {...base, ...patch};
  const keys = Object.keys(merged).filter(
    k => merged[k as keyof typeof merged] != null,
  );
  if (keys.length === 0) {
    return undefined;
  }
  return {
    protocol: 'openai',
    openai: merged,
  };
}

function patchAnthropic(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams | undefined {
  const base = prev?.protocol === 'anthropic' ? {...prev.anthropic} : {};
  const merged = {...base, ...patch};
  const keys = Object.keys(merged).filter(
    k => merged[k as keyof typeof merged] != null,
  );
  if (keys.length === 0) {
    return undefined;
  }
  return {
    protocol: 'anthropic',
    anthropic: merged,
  };
}

function patchGemini(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams | undefined {
  const base = prev?.protocol === 'gemini' ? {...prev.gemini} : {};
  const merged = {...base, ...patch};
  const keys = Object.keys(merged).filter(
    k => merged[k as keyof typeof merged] != null,
  );
  if (keys.length === 0) {
    return undefined;
  }
  return {
    protocol: 'gemini',
    gemini: merged,
  };
}

export function SamplingForm({protocol, params, onChange}: Props) {
  const {tokens} = useTheme();
  const openai = params?.protocol === 'openai' ? params.openai : {};
  const anthropic = params?.protocol === 'anthropic' ? params.anthropic : {};
  const gemini = params?.protocol === 'gemini' ? params.gemini : {};

  return (
    <View style={styles.root}>
      <Text style={[styles.hint, {color: tokens.textSecondary}]}>
        留空表示使用协议默认参数。
      </Text>
      {protocol === 'openai' ? (
        <>
          <NumberField
            label="温度"
            value={numStr(openai.temperature)}
            onChangeText={v =>
              onChange(patchOpenAi(params, {temperature: parseOptionalNumber(v)}))
            }
          />
          <NumberField
            label="Top P"
            value={numStr(openai.top_p)}
            onChangeText={v =>
              onChange(patchOpenAi(params, {top_p: parseOptionalNumber(v)}))
            }
          />
          <NumberField
            label="Max Tokens"
            value={numStr(openai.max_tokens)}
            onChangeText={v =>
              onChange(
                patchOpenAi(params, {max_tokens: parseOptionalNumber(v)}),
              )
            }
          />
        </>
      ) : null}
      {protocol === 'anthropic' ? (
        <>
          <NumberField
            label="温度"
            value={numStr(anthropic.temperature)}
            onChangeText={v =>
              onChange(
                patchAnthropic(params, {temperature: parseOptionalNumber(v)}),
              )
            }
          />
          <NumberField
            label="Top P"
            value={numStr(anthropic.top_p)}
            onChangeText={v =>
              onChange(patchAnthropic(params, {top_p: parseOptionalNumber(v)}))
            }
          />
          <NumberField
            label="Top K"
            value={numStr(anthropic.top_k)}
            onChangeText={v =>
              onChange(patchAnthropic(params, {top_k: parseOptionalNumber(v)}))
            }
          />
          <NumberField
            label="Max Tokens"
            value={numStr(anthropic.max_tokens)}
            onChangeText={v =>
              onChange(
                patchAnthropic(params, {max_tokens: parseOptionalNumber(v)}),
              )
            }
          />
        </>
      ) : null}
      {protocol === 'gemini' ? (
        <>
          <NumberField
            label="温度"
            value={numStr(gemini.temperature)}
            onChangeText={v =>
              onChange(patchGemini(params, {temperature: parseOptionalNumber(v)}))
            }
          />
          <NumberField
            label="Top P"
            value={numStr(gemini.topP)}
            onChangeText={v =>
              onChange(patchGemini(params, {topP: parseOptionalNumber(v)}))
            }
          />
          <NumberField
            label="Top K"
            value={numStr(gemini.topK)}
            onChangeText={v =>
              onChange(patchGemini(params, {topK: parseOptionalNumber(v)}))
            }
          />
          <NumberField
            label="Max Output Tokens"
            value={numStr(gemini.maxOutputTokens)}
            onChangeText={v =>
              onChange(
                patchGemini(params, {
                  maxOutputTokens: parseOptionalNumber(v),
                }),
              )
            }
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {gap: 12},
  hint: {fontSize: 13, marginBottom: 4},
  field: {gap: 4},
  label: {fontSize: 13},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
});
