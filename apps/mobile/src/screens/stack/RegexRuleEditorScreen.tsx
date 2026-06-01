/**
 * Create/edit regex rule with test preview.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {FormField} from '../../components/form/FormField';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormSwitchRow} from '../../components/form/FormSwitchRow';
import {FormTextInput} from '../../components/form/FormTextInput';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {SegmentedControl} from '../../components/ui/SegmentedControl';
import {
  parseOptionalDepthInput,
  previewRegexRule,
  regexPreviewRoleFromScope,
  validateRegexRuleDraft,
  type RegexChannel,
  type RegexRuleDraftFields,
} from '../../services/regex-test.service';
import {useRuntime} from '../../hooks/useRuntime';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import type {RootStackParamList} from '../../navigation/types';

type EditorRoute = RouteProp<RootStackParamList, 'RegexRuleEditor'>;

function slugifyRuleId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'rule'
  );
}

const DEFAULT_DRAFT: RegexRuleDraftFields = {
  name: '',
  pattern: '',
  flags: 'gim',
  enabled: true,
  llmReplace: null,
  displayReplace: null,
  startDepth: 0,
  endDepth: null,
  scopeUser: true,
  scopeAssistant: true,
};

const CHANNEL_OPTIONS = [
  {value: 'display' as const, label: '显示'},
  {value: 'llm' as const, label: '模型'},
];

export function RegexRuleEditorScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation();
  const route = useRoute<EditorRoute>();
  const groupId = route.params?.groupId;
  const ruleId = route.params?.ruleId;

  const [draft, setDraft] = useState<RegexRuleDraftFields>(DEFAULT_DRAFT);
  const [llmEnabled, setLlmEnabled] = useState(false);
  const [displayEnabled, setDisplayEnabled] = useState(false);
  const [testText, setTestText] = useState('mysecret@email.com');
  const [testChannel, setTestChannel] = useState<RegexChannel>('display');
  const [testDepthFromTail, setTestDepthFromTail] = useState('0');
  const [previewOutput, setPreviewOutput] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [loading, setLoading] = useState(Boolean(ruleId));
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState('');

  const snapshot = useMemo(
    () =>
      JSON.stringify({
        draft,
        llmEnabled,
        displayEnabled,
      }),
    [draft, llmEnabled, displayEnabled],
  );
  const dirty = snapshot !== baseline;
  const {allowLeaveWithoutPrompt} = useUnsavedGuard(dirty);

  const patchDraft = (patch: Partial<RegexRuleDraftFields>) => {
    setDraft(prev => ({...prev, ...patch}));
  };

  const load = useCallback(async () => {
    if (!groupId || !ruleId) {
      setBaseline(
        JSON.stringify({
          draft: DEFAULT_DRAFT,
          llmEnabled: false,
          displayEnabled: false,
        }),
      );
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rule = await runtime.regexConfig.getRule(groupId, ruleId);
      const loaded: RegexRuleDraftFields = {
        name: rule.name,
        pattern: rule.pattern,
        flags: rule.flags,
        enabled: rule.enabled,
        llmReplace: rule.llmReplace,
        displayReplace: rule.displayReplace,
        startDepth: rule.startDepth,
        endDepth: rule.endDepth,
        scopeUser: rule.scopeUser,
        scopeAssistant: rule.scopeAssistant,
      };
      const llmOn = rule.llmReplace != null && rule.llmReplace !== '';
      const displayOn = rule.displayReplace != null && rule.displayReplace !== '';
      setDraft(loaded);
      setLlmEnabled(llmOn);
      setDisplayEnabled(displayOn);
      setBaseline(
        JSON.stringify({
          draft: loaded,
          llmEnabled: llmOn,
          displayEnabled: displayOn,
        }),
      );
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, groupId, ruleId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!groupId) {
      showToast(toastMessage('错误', '缺少 groupId'));
      navigation.goBack();
    }
  }, [groupId, navigation, showToast]);

  const collectFields = (): RegexRuleDraftFields | null => {
    if (!draft.name.trim()) {
      showToast('请填写规则名称');
      return null;
    }
    if (!draft.pattern.trim()) {
      showToast('请填写正则表达式');
      return null;
    }
    return {
      ...draft,
      name: draft.name.trim(),
      pattern: draft.pattern.trim(),
      flags: draft.flags.trim(),
      llmReplace: llmEnabled ? draft.llmReplace : null,
      displayReplace: displayEnabled ? draft.displayReplace : null,
      startDepth: draft.startDepth,
      endDepth: draft.endDepth,
    };
  };

  const updatePreview = useCallback(() => {
    const fields: RegexRuleDraftFields = {
      ...draft,
      llmReplace: llmEnabled ? draft.llmReplace : null,
      displayReplace: displayEnabled ? draft.displayReplace : null,
    };
    if (!fields.name.trim() || !fields.pattern.trim()) {
      setPreviewOutput('请填写名称与正则表达式后再预览');
      setPreviewError(true);
      return;
    }
    const validation = validateRegexRuleDraft(fields);
    if (!validation.ok) {
      setPreviewOutput(validation.message);
      setPreviewError(true);
      return;
    }
    const depthFromTail = Math.max(
      0,
      Number.parseInt(testDepthFromTail, 10) || 0,
    );
    const result = previewRegexRule(testText, fields, {
      channel: testChannel,
      depthFromTail,
      role: regexPreviewRoleFromScope(fields),
      text: testText,
    });
    if (!result.ok) {
      setPreviewOutput(result.message);
      setPreviewError(true);
      return;
    }
    setPreviewOutput(result.text);
    setPreviewError(false);
  }, [draft, llmEnabled, displayEnabled, testText, testChannel, testDepthFromTail]);

  useEffect(() => {
    updatePreview();
  }, [updatePreview]);

  const handleSave = async () => {
    if (!groupId) {
      return;
    }
    const fields = collectFields();
    if (!fields) {
      return;
    }
    const validation = validateRegexRuleDraft(fields);
    if (!validation.ok) {
      showToast(validation.message);
      return;
    }
    setSaving(true);
    try {
      if (ruleId) {
        await runtime.regexConfig.updateRule(groupId, ruleId, fields);
      } else {
        const newRuleId = `${slugifyRuleId(fields.name)}-${Date.now()}`;
        await runtime.regexConfig.createRule({
          groupId,
          ruleId: newRuleId,
          ...fields,
        });
      }
      setBaseline(snapshot);
      showToast('已保存规则');
      allowLeaveWithoutPrompt();
      navigation.goBack();
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <ScreenFormLayout
      tokens={tokens}
      footer={
        <View>
          {dirty ? (
            <Text style={[styles.unsaved, {color: tokens.danger}]}>
              未保存的更改
            </Text>
          ) : null}
          <StickyFormFooter
            tokens={tokens}
            label="保存"
            loading={saving}
            onPress={() => handleSave().catch(() => undefined)}
          />
        </View>
      }>
      <FormSectionCard title="规则" tokens={tokens}>
        <FormField label="名称" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={draft.name}
            onChangeText={v => patchDraft({name: v})}
            placeholder="如 隐藏邮箱"
          />
        </FormField>
        <FormField label="正则表达式" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={draft.pattern}
            onChangeText={v => patchDraft({pattern: v})}
            placeholder="如 [a-z]+@[a-z]+\\.[a-z]+"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormField
          label="Flags"
          tokens={tokens}
          hint="常用 gim：全局、忽略大小写、多行。">
          <FormTextInput
            tokens={tokens}
            value={draft.flags}
            onChangeText={v => patchDraft({flags: v})}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </FormField>
        <FormSwitchRow
          tokens={tokens}
          label="启用规则"
          value={draft.enabled}
          onValueChange={v => patchDraft({enabled: v})}
        />
      </FormSectionCard>

      <FormSectionCard
        title="深度范围（自最新消息起）"
        tokens={tokens}
        hint="0 = 最新一条；留空表示该侧无界。至少填一侧。">
        <View style={styles.row2}>
          <View style={styles.cell}>
            <FormField label="start-depth" tokens={tokens}>
              <FormTextInput
                tokens={tokens}
                value={
                  draft.startDepth != null ? String(draft.startDepth) : ''
                }
                onChangeText={v =>
                  patchDraft({startDepth: parseOptionalDepthInput(v)})
                }
                placeholder="0"
                keyboardType="number-pad"
              />
            </FormField>
          </View>
          <View style={styles.cell}>
            <FormField label="end-depth" tokens={tokens}>
              <FormTextInput
                tokens={tokens}
                value={draft.endDepth != null ? String(draft.endDepth) : ''}
                onChangeText={v =>
                  patchDraft({endDepth: parseOptionalDepthInput(v)})
                }
                placeholder="∞"
                keyboardType="number-pad"
              />
            </FormField>
          </View>
        </View>
      </FormSectionCard>

      <FormSectionCard title="作用范围" tokens={tokens} hint="按消息角色生效。">
        <FormSwitchRow
          tokens={tokens}
          label="用户消息"
          value={draft.scopeUser}
          onValueChange={v => patchDraft({scopeUser: v})}
        />
        <FormSwitchRow
          tokens={tokens}
          label="助手消息"
          value={draft.scopeAssistant}
          onValueChange={v => patchDraft({scopeAssistant: v})}
        />
      </FormSectionCard>

      <FormSectionCard title="提示词替换" tokens={tokens}>
        <FormSwitchRow
          tokens={tokens}
          label="改写送入模型的文本"
          description="对应 llm 通道；关闭时不替换。"
          value={llmEnabled}
          onValueChange={setLlmEnabled}
        />
        {llmEnabled ? (
          <FormField label="替换为" tokens={tokens}>
            <FormTextInput
              tokens={tokens}
              value={draft.llmReplace ?? ''}
              onChangeText={v => patchDraft({llmReplace: v})}
              placeholder="如 [redacted]"
            />
          </FormField>
        ) : null}
      </FormSectionCard>

      <FormSectionCard title="显示替换" tokens={tokens}>
        <FormSwitchRow
          tokens={tokens}
          label="改写界面展示文本"
          description="对应 display 通道；关闭时不替换。"
          value={displayEnabled}
          onValueChange={setDisplayEnabled}
        />
        {displayEnabled ? (
          <FormField label="替换为" tokens={tokens}>
            <FormTextInput
              tokens={tokens}
              value={draft.displayReplace ?? ''}
              onChangeText={v => patchDraft({displayReplace: v})}
              placeholder="如 ***"
            />
          </FormField>
        ) : null}
      </FormSectionCard>

      <FormSectionCard title="测试预览" tokens={tokens} hint="保存前可本地试跑。">
        <FormField label="样例文本" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            multiline
            value={testText}
            onChangeText={setTestText}
          />
        </FormField>
        <FormField label="预览通道" tokens={tokens}>
          <SegmentedControl
            tokens={tokens}
            options={CHANNEL_OPTIONS}
            value={testChannel}
            onChange={setTestChannel}
          />
        </FormField>
        <FormField
          label="预览深度 depthFromTail"
          tokens={tokens}
          hint="模拟该条消息距最新可见消息的尾深度（0=最新）。">
          <FormTextInput
            tokens={tokens}
            value={testDepthFromTail}
            onChangeText={setTestDepthFromTail}
            keyboardType="number-pad"
          />
        </FormField>
        <FormField label="预览结果" tokens={tokens}>
          <View
            style={[
              styles.previewBox,
              {
                backgroundColor: tokens.bgSecondary,
                borderColor: tokens.borderLight,
              },
            ]}>
            <Text
              style={[
                styles.previewText,
                {color: previewError ? tokens.danger : tokens.text},
              ]}>
              {previewOutput}
            </Text>
          </View>
        </FormField>
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  loader: {marginTop: 32},
  unsaved: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  row2: {flexDirection: 'row', gap: 12},
  cell: {flex: 1},
  previewBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    minHeight: 56,
  },
  previewText: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
  },
});
