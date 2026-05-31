/**
 * Protocol-specific model sampling fields (openai / anthropic / gemini).
 */
import React, {useMemo} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {
  mergeSamplingWithDefaults,
  type LlmProtocolKind,
  type ModelSamplingParams,
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

function parseNumber(raw: string): number | undefined {
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
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
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
      />
    </View>
  );
}

function patchOpenAi(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams {
  const base = prev?.protocol === 'openai' ? {...prev.openai} : {};
  return {
    protocol: 'openai',
    openai: {...base, ...patch},
  };
}

function patchAnthropic(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams {
  const base = prev?.protocol === 'anthropic' ? {...prev.anthropic} : {};
  return {
    protocol: 'anthropic',
    anthropic: {...base, ...patch},
  };
}

function patchGemini(
  prev: ModelSamplingParams | undefined,
  patch: Record<string, number | undefined>,
): ModelSamplingParams {
  const base = prev?.protocol === 'gemini' ? {...prev.gemini} : {};
  return {
    protocol: 'gemini',
    gemini: {...base, ...patch},
  };
}

export function SamplingForm({protocol, params, onChange}: Props) {
  const {tokens} = useTheme();
  const effective = useMemo(
    () => mergeSamplingWithDefaults(protocol, params),
    [protocol, params],
  );
  const openai = effective.protocol === 'openai' ? effective.openai : {};
  const anthropic = effective.protocol === 'anthropic' ? effective.anthropic : {};
  const gemini = effective.protocol === 'gemini' ? effective.gemini : {};

  return (
    <View style={styles.root}>
      <Text style={[styles.hint, {color: tokens.textSecondary}]}>
        展示协议推荐默认值；保存后以本页为准。
      </Text>
      {protocol === 'openai' ? (
        <>
          <NumberField
            label="温度"
            value={numStr(openai.temperature)}
            onChangeText={v =>
              onChange(patchOpenAi(params, {temperature: parseNumber(v)}))
            }
          />
          <NumberField
            label="Top P"
            value={numStr(openai.top_p)}
            onChangeText={v =>
              onChange(patchOpenAi(params, {top_p: parseNumber(v)}))
            }
          />
          <NumberField
            label="Max Tokens"
            value={numStr(openai.max_tokens)}
            onChangeText={v =>
              onChange(patchOpenAi(params, {max_tokens: parseNumber(v)}))
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
                patchAnthropic(params, {temperature: parseNumber(v)}),
              )
            }
          />
          <NumberField
            label="Top P"
            value={numStr(anthropic.top_p)}
            onChangeText={v =>
              onChange(patchAnthropic(params, {top_p: parseNumber(v)}))
            }
          />
          <NumberField
            label="Top K"
            value={numStr(anthropic.top_k)}
            onChangeText={v =>
              onChange(patchAnthropic(params, {top_k: parseNumber(v)}))
            }
          />
          <NumberField
            label="Max Tokens"
            value={numStr(anthropic.max_tokens)}
            onChangeText={v =>
              onChange(
                patchAnthropic(params, {max_tokens: parseNumber(v)}),
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
              onChange(patchGemini(params, {temperature: parseNumber(v)}))
            }
          />
          <NumberField
            label="Top P"
            value={numStr(gemini.topP)}
            onChangeText={v =>
              onChange(patchGemini(params, {topP: parseNumber(v)}))
            }
          />
          <NumberField
            label="Top K"
            value={numStr(gemini.topK)}
            onChangeText={v =>
              onChange(patchGemini(params, {topK: parseNumber(v)}))
            }
          />
          <NumberField
            label="Max Output Tokens"
            value={numStr(gemini.maxOutputTokens)}
            onChangeText={v =>
              onChange(
                patchGemini(params, {
                  maxOutputTokens: parseNumber(v),
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
