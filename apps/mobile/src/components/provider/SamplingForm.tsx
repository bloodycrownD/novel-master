/**
 * Protocol-specific model sampling fields (openai / anthropic / gemini).
 */
import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import {
  mergeSamplingWithDefaults,
  type LlmProtocolKind,
  type ModelSamplingParams,
} from '@novel-master/core';
import {FormField} from '../form/FormField';
import {FormTextInput} from '../form/FormTextInput';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
  tokens: ThemeTokens;
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
  tokens,
  label,
  value,
  onChangeText,
}: {
  tokens: ThemeTokens;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
}) {
  return (
    <FormField label={label} tokens={tokens}>
      <FormTextInput
        tokens={tokens}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
      />
    </FormField>
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

export function SamplingForm({tokens, protocol, params, onChange}: Props) {
  const effective = useMemo(
    () => mergeSamplingWithDefaults(protocol, params),
    [protocol, params],
  );
  const openai = effective.protocol === 'openai' ? effective.openai : {};
  const anthropic = effective.protocol === 'anthropic' ? effective.anthropic : {};
  const gemini = effective.protocol === 'gemini' ? effective.gemini : {};

  return (
    <View style={styles.root}>
      {protocol === 'openai' ? (
        <>
          <NumberField
            tokens={tokens}
            label="温度"
            value={numStr(openai.temperature)}
            onChangeText={v =>
              onChange(patchOpenAi(params, {temperature: parseNumber(v)}))
            }
          />
          <NumberField
            tokens={tokens}
            label="Top P"
            value={numStr(openai.top_p)}
            onChangeText={v =>
              onChange(patchOpenAi(params, {top_p: parseNumber(v)}))
            }
          />
          <NumberField
            tokens={tokens}
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
            tokens={tokens}
            label="温度"
            value={numStr(anthropic.temperature)}
            onChangeText={v =>
              onChange(
                patchAnthropic(params, {temperature: parseNumber(v)}),
              )
            }
          />
          <NumberField
            tokens={tokens}
            label="Top P"
            value={numStr(anthropic.top_p)}
            onChangeText={v =>
              onChange(patchAnthropic(params, {top_p: parseNumber(v)}))
            }
          />
          <NumberField
            tokens={tokens}
            label="Top K"
            value={numStr(anthropic.top_k)}
            onChangeText={v =>
              onChange(patchAnthropic(params, {top_k: parseNumber(v)}))
            }
          />
          <NumberField
            tokens={tokens}
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
            tokens={tokens}
            label="温度"
            value={numStr(gemini.temperature)}
            onChangeText={v =>
              onChange(patchGemini(params, {temperature: parseNumber(v)}))
            }
          />
          <NumberField
            tokens={tokens}
            label="Top P"
            value={numStr(gemini.topP)}
            onChangeText={v =>
              onChange(patchGemini(params, {topP: parseNumber(v)}))
            }
          />
          <NumberField
            tokens={tokens}
            label="Top K"
            value={numStr(gemini.topK)}
            onChangeText={v =>
              onChange(patchGemini(params, {topK: parseNumber(v)}))
            }
          />
          <NumberField
            tokens={tokens}
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
  root: {gap: 10},
});
