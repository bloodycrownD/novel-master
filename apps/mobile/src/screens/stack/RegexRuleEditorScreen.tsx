/**
 * Create/edit regex rule with test preview.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import {
  previewRegexRule,
  regexPreviewRoleFromScope,
  validateRegexRuleDraft,
  type RegexChannel,
  type RegexRuleDraftFields,
} from '../../services/regex-test.service';
import {useRuntime} from '../../hooks/useRuntime';
import {useUnsavedGuard} from '../../hooks/useUnsavedGuard';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

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
  flags: '',
  enabled: true,
  llmReplace: null,
  displayReplace: null,
  minDepth: 1,
  maxDepth: 99,
  scopeUser: true,
  scopeAssistant: true,
};

export function RegexRuleEditorScreen() {
  const {tokens} = useTheme();
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
  useUnsavedGuard(dirty);

  const patchDraft = (patch: Partial<RegexRuleDraftFields>) => {
    setDraft(prev => ({...prev, ...patch}));
  };

  const load = useCallback(async () => {
    if (!groupId || !ruleId) {
      setBaseline(JSON.stringify({draft: DEFAULT_DRAFT, llmEnabled: false, displayEnabled: false}));
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
        minDepth: rule.minDepth,
        maxDepth: rule.maxDepth,
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
      Alert.alert(
        '加载失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setLoading(false);
    }
  }, [runtime, groupId, ruleId]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!groupId) {
      Alert.alert('错误', '缺少 groupId', [
        {text: '返回', onPress: () => navigation.goBack()},
      ]);
    }
  }, [groupId, navigation]);

  const collectFields = (): RegexRuleDraftFields | null => {
    if (!draft.name.trim()) {
      Alert.alert('请填写规则名称');
      return null;
    }
    if (!draft.pattern.trim()) {
      Alert.alert('请填写正则表达式');
      return null;
    }
    return {
      ...draft,
      name: draft.name.trim(),
      pattern: draft.pattern.trim(),
      flags: draft.flags.trim(),
      llmReplace: llmEnabled ? draft.llmReplace : null,
      displayReplace: displayEnabled ? draft.displayReplace : null,
      minDepth: Math.max(1, draft.minDepth),
      maxDepth: Math.max(1, draft.maxDepth),
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
    const result = previewRegexRule(testText, fields, {
      channel: testChannel,
      floor: fields.minDepth,
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
  }, [draft, llmEnabled, displayEnabled, testText, testChannel]);

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
      Alert.alert(validation.message);
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
      Alert.alert('已保存规则');
      navigation.goBack();
    } catch (error) {
      Alert.alert(
        '保存失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ActivityIndicator style={styles.loader} />;
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.sectionTitle, {color: tokens.text}]}>规则</Text>
        <Text style={[styles.label, {color: tokens.textSecondary}]}>名称</Text>
        <TextInput
          style={[styles.input, {color: tokens.text, borderColor: tokens.border}]}
          value={draft.name}
          onChangeText={v => patchDraft({name: v})}
        />
        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          正则表达式
        </Text>
        <TextInput
          style={[styles.input, {color: tokens.text, borderColor: tokens.border}]}
          value={draft.pattern}
          onChangeText={v => patchDraft({pattern: v})}
          autoCapitalize="none"
        />
        <Text style={[styles.label, {color: tokens.textSecondary}]}>flags</Text>
        <TextInput
          style={[styles.input, {color: tokens.text, borderColor: tokens.border}]}
          value={draft.flags}
          onChangeText={v => patchDraft({flags: v})}
          placeholder="gim"
          placeholderTextColor={tokens.textSecondary}
          autoCapitalize="none"
        />
        <View style={styles.switchRow}>
          <Text style={{color: tokens.text}}>启用规则</Text>
          <Switch
            value={draft.enabled}
            onValueChange={v => patchDraft({enabled: v})}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
        <View style={styles.grid}>
          <View style={styles.gridCell}>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              最小层数
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={String(draft.minDepth)}
              onChangeText={v =>
                patchDraft({minDepth: Math.max(1, Number(v) || 1)})
              }
              keyboardType="number-pad"
            />
          </View>
          <View style={styles.gridCell}>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              最大层数
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={String(draft.maxDepth)}
              onChangeText={v =>
                patchDraft({maxDepth: Math.max(1, Number(v) || 1)})
              }
              keyboardType="number-pad"
            />
          </View>
        </View>
        <Text style={[styles.hint, {color: tokens.textSecondary}]}>
          作用范围 (role)
        </Text>
        <View style={styles.switchRow}>
          <Text style={{color: tokens.text}}>用户 (user)</Text>
          <Switch
            value={draft.scopeUser}
            onValueChange={v => patchDraft({scopeUser: v})}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
        <View style={styles.switchRow}>
          <Text style={{color: tokens.text}}>助手 (assistant)</Text>
          <Switch
            value={draft.scopeAssistant}
            onValueChange={v => patchDraft({scopeAssistant: v})}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, {color: tokens.text}]}>
            提示词替换
          </Text>
          <Switch
            value={llmEnabled}
            onValueChange={setLlmEnabled}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
        {llmEnabled ? (
          <>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              替换为
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={draft.llmReplace ?? ''}
              onChangeText={v => patchDraft({llmReplace: v})}
              placeholder="如 [redacted]"
              placeholderTextColor={tokens.textSecondary}
            />
          </>
        ) : (
          <Text style={[styles.hint, {color: tokens.textSecondary}]}>
            关闭时不改写送入模型的文本（llm 通道）。
          </Text>
        )}

        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, {color: tokens.text}]}>
            显示替换
          </Text>
          <Switch
            value={displayEnabled}
            onValueChange={setDisplayEnabled}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </View>
        {displayEnabled ? (
          <>
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              替换为
            </Text>
            <TextInput
              style={[
                styles.input,
                {color: tokens.text, borderColor: tokens.border},
              ]}
              value={draft.displayReplace ?? ''}
              onChangeText={v => patchDraft({displayReplace: v})}
              placeholder="如 ***"
              placeholderTextColor={tokens.textSecondary}
            />
          </>
        ) : (
          <Text style={[styles.hint, {color: tokens.textSecondary}]}>
            关闭时不改写列表/终端展示文本（display 通道）。
          </Text>
        )}

        <Text style={[styles.sectionTitle, {color: tokens.text}]}>
          测试预览
        </Text>
        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          样例文本
        </Text>
        <TextInput
          style={[
            styles.input,
            styles.textArea,
            {color: tokens.text, borderColor: tokens.border},
          ]}
          value={testText}
          onChangeText={setTestText}
          multiline
        />
        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          通道 (channel)
        </Text>
        <View style={styles.chips}>
          {(['display', 'llm'] as const).map(ch => (
            <Pressable
              key={ch}
              style={[
                styles.chip,
                {
                  borderColor: tokens.border,
                  backgroundColor:
                    testChannel === ch ? tokens.primary : tokens.surface,
                },
              ]}
              onPress={() => setTestChannel(ch)}>
              <Text
                style={{color: testChannel === ch ? '#fff' : tokens.text}}>
                {ch}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.label, {color: tokens.textSecondary}]}>
          预览输出
        </Text>
        <Text
          style={[
            styles.preview,
            {
              color: previewError ? tokens.danger : tokens.text,
              borderColor: tokens.border,
              backgroundColor: tokens.surface,
            },
          ]}>
          {previewOutput}
        </Text>
      </ScrollView>
      <View style={[styles.footer, {borderTopColor: tokens.border}]}>
        {dirty ? (
          <Text style={[styles.unsaved, {color: tokens.danger}]}>未保存</Text>
        ) : null}
        <Pressable
          style={[styles.saveBtn, {backgroundColor: tokens.primary}]}
          onPress={() => handleSave().catch(() => undefined)}
          disabled={saving}>
          <Text style={styles.saveBtnText}>
            {saving ? '保存中…' : '保存'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loader: {marginTop: 32},
  scroll: {padding: 16, gap: 6, paddingBottom: 24},
  sectionTitle: {fontSize: 17, fontWeight: '600', marginTop: 12},
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
  label: {fontSize: 13, marginTop: 4},
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {minHeight: 72, textAlignVertical: 'top'},
  hint: {fontSize: 12},
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  grid: {flexDirection: 'row', gap: 12},
  gridCell: {flex: 1},
  chips: {flexDirection: 'row', gap: 8, marginTop: 4},
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  preview: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
    fontFamily: 'monospace',
    fontSize: 14,
    minHeight: 48,
  },
  footer: {padding: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8},
  unsaved: {fontSize: 13, textAlign: 'center'},
  saveBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 8,
  },
  saveBtnText: {color: '#fff', fontWeight: '600', fontSize: 16},
});
