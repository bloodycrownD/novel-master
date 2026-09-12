/**
 * Create/edit smart sort rule with live test preview
 * (spec smart-filename-sort Step 13).
 * 正则输入支持 /pattern/flags 字面量风格（core parsePatternInput 单源）：
 * 输入框绑定原始文本 patternInput，解析结果同步进 draft.pattern/flags，
 * 预览/保存均消费解析值；复杂正则可进全屏编辑（照 agent 配置
 * PromptEditorScreen 先例，保存回填 + 未保存拦截）。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  formatPatternInput,
  parsePatternInput,
  validateSmartSortRuleDraft,
  type SmartSortRule,
} from '@novel-master/core/smart-sort-rule';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormSwitchRow} from '@/components/form/FormSwitchRow';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {setPatternEditorOnSaved} from '@/components/smart-sort/pattern-editor-callback';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';
import {useUnsavedGuard} from '@/hooks/useUnsavedGuard';
import type {RootStackParamList} from '@/navigation/types';

type EditorRoute = RouteProp<RootStackParamList, 'SmartSortRuleEditor'>;
type StackNav = NativeStackNavigationProp<RootStackParamList>;

interface DraftFields {
  name: string;
  /** 正则输入框原始文本（可能是 /pattern/flags 字面量风格）。 */
  patternInput: string;
  /** parsePatternInput(patternInput) 的解析结果（预览/保存消费）。 */
  pattern: string;
  flags: string;
  example: string;
  enabled: boolean;
}

const DEFAULT_DRAFT: DraftFields = {
  name: '',
  patternInput: '',
  pattern: '',
  flags: '',
  example: '',
  enabled: true,
};

const DEFAULT_TEST_INPUT = '第一章.txt\n第二章.txt\n第十章.txt';

export function SmartSortRuleEditorScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<StackNav>();
  const route = useRoute<EditorRoute>();
  const ruleId = route.params?.ruleId;

  const [draft, setDraft] = useState<DraftFields>(DEFAULT_DRAFT);
  const [testText, setTestText] = useState(DEFAULT_TEST_INPUT);
  const [previewOutput, setPreviewOutput] = useState('');
  const [previewError, setPreviewError] = useState(false);
  const [loading, setLoading] = useState(Boolean(ruleId));
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState('');

  const snapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = snapshot !== baseline;
  const {allowLeaveWithoutPrompt} = useUnsavedGuard(dirty);

  const patchDraft = (patch: Partial<DraftFields>) => {
    setDraft(prev => ({...prev, ...patch}));
  };

  // 输入框文本同步解析为 pattern/flags（非法字面量自动当裸 pattern）；
  // 函数式更新不捕获旧 draft，全屏回填与就地输入共用。
  const applyPatternInput = useCallback((text: string) => {
    setDraft(prev => ({...prev, patternInput: text, ...parsePatternInput(text)}));
  }, []);

  // 全屏编辑入口（照 AgentEditorForm.openPromptEditor 先例）：回调先写进
  // 模块级存取再 push，保存才回填 patternInput 并重新解析。
  const openPatternEditor = useCallback(() => {
    setPatternEditorOnSaved(applyPatternInput);
    navigation.push('PatternEditor', {
      title: '正则表达式',
      initialText: draft.patternInput,
    });
  }, [navigation, draft.patternInput, applyPatternInput]);

  const load = useCallback(async () => {
    if (!ruleId) {
      setBaseline(JSON.stringify(DEFAULT_DRAFT));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // service 只提供 listRules；单条按 id 查找（列表量级小）。
      const rules = await runtime.smartSortRule.listRules();
      const rule = rules.find(r => r.ruleId === ruleId);
      if (!rule) {
        showToast('规则不存在或已删除');
        navigation.goBack();
        return;
      }
      const loaded = toDraft(rule);
      setDraft(loaded);
      setBaseline(JSON.stringify(loaded));
    } catch (error) {
      showToast(toastMessage('加载失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, ruleId, navigation, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const collectFields = (): DraftFields | null => {
    if (!draft.name.trim()) {
      showToast('请填写规则名称');
      return null;
    }
    if (!draft.patternInput.trim()) {
      showToast('请填写正则表达式');
      return null;
    }
    // 保存前以 trim 后的输入重新解析（避免尾随空白把字面量拆成裸 pattern）。
    const parsed = parsePatternInput(draft.patternInput.trim());
    return {
      ...draft,
      name: draft.name.trim(),
      patternInput: draft.patternInput.trim(),
      pattern: parsed.pattern,
      flags: parsed.flags,
      example: draft.example.trim(),
    };
  };

  // ---- 测试预览：草稿规则逐行试跑 + 排序结果（非法正则只提示不阻断输入） ----

  const updatePreview = useCallback(() => {
    if (!draft.name.trim() || !draft.patternInput.trim()) {
      setPreviewOutput('请填写名称与正则表达式后再预览');
      setPreviewError(true);
      return;
    }
    const names = testText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    if (names.length === 0) {
      setPreviewOutput('请在上方输入待测试的文件名（每行一个）');
      setPreviewError(true);
      return;
    }
    // previewSort 内部会编译草稿正则：非法正则/零捕获组在这里抛错并只作提示。
    runtime.smartSortRule
      .previewSort(names, [
        {
          ruleId: ruleId ?? 'draft',
          name: draft.name,
          pattern: draft.pattern,
          flags: draft.flags,
        },
      ])
      .then(result => {
        const detailLines = result.lines.map(line =>
          line.matchedRuleId != null
            ? `${line.name} → ${line.matchedRuleId} [${line.nums?.join(', ')}]`
            : `${line.name} → 未命中`,
        );
        const sortedLines = result.sortedNames.map(
          (name, index) => `${index + 1}. ${name}`,
        );
        setPreviewOutput(
          [...detailLines, '', '排序后：', ...sortedLines].join('\n'),
        );
        setPreviewError(false);
      })
      .catch(error => {
        setPreviewOutput(toastMessage('预览失败', error));
        setPreviewError(true);
      });
  }, [runtime, ruleId, draft.name, draft.patternInput, draft.pattern, draft.flags, testText]);

  useEffect(() => {
    updatePreview();
  }, [updatePreview]);

  const handleSave = async () => {
    const fields = collectFields();
    if (!fields) {
      return;
    }
    try {
      // 保存前走同一校验（非法正则/flags/捕获组），提示语与预览一致。
      validateSmartSortRuleDraft({
        name: fields.name,
        pattern: fields.pattern,
        flags: fields.flags,
      });
    } catch (error) {
      showToast(toastMessage('无法保存', error));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: fields.name,
        pattern: fields.pattern,
        flags: fields.flags,
        example: fields.example === '' ? null : fields.example,
        enabled: fields.enabled,
      };
      if (ruleId) {
        await runtime.smartSortRule.updateRule(ruleId, payload);
      } else {
        await runtime.smartSortRule.createRule(payload);
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
      }
    >
      <FormSectionCard
        title="规则"
        tokens={tokens}
        hint="按优先级逐条尝试，首个命中者以捕获组提取序号（须含至少一个捕获组）。"
      >
        <FormField label="名称" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={draft.name}
            onChangeText={v => patchDraft({name: v})}
            placeholder="如 中文序号章节"
          />
        </FormField>
        <FormField
          label="正则表达式"
          tokens={tokens}
          hint="支持 /正则/flags 格式，如 /第(\d+)章/i"
        >
          <FormTextInput
            tokens={tokens}
            value={draft.patternInput}
            onChangeText={applyPatternInput}
            placeholder="如 /第([0-9〇零一二两三四五六七八九十百千]+)章/i"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            testID="pattern-fullscreen-entry"
            accessibilityRole="button"
            accessibilityLabel="全屏编辑"
            onPress={openPatternEditor}
            style={styles.expandBtn}
          >
            <Text style={[styles.expandBtnText, {color: tokens.primary}]}>
              全屏编辑
            </Text>
          </Pressable>
        </FormField>
        <FormField label="示例" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={draft.example}
            onChangeText={v => patchDraft({example: v})}
            placeholder="如 第十二章 风起"
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
        title="测试预览"
        tokens={tokens}
        hint="用当前编辑中的规则测试；每行一个文件名。"
      >
        <FormField label="文件名列表" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            multiline
            value={testText}
            onChangeText={setTestText}
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
            ]}
          >
            <Text
              style={[
                styles.previewText,
                {color: previewError ? tokens.danger : tokens.text},
              ]}
            >
              {previewOutput}
            </Text>
          </View>
        </FormField>
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

function toDraft(rule: SmartSortRule): DraftFields {
  return {
    name: rule.name,
    // 回显：pattern+flags 拼回 /pattern/flags 字面量风格（flags 空则裸 pattern），
    // 再解析回同一 pattern/flags（core 单测保障 round-trip）。
    patternInput: formatPatternInput(rule.pattern, rule.flags),
    pattern: rule.pattern,
    flags: rule.flags,
    example: rule.example ?? '',
    enabled: rule.enabled,
  };
}

const styles = StyleSheet.create({
  loader: {marginTop: 32},
  unsaved: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  expandBtn: {alignSelf: 'flex-end', paddingVertical: 6},
  expandBtnText: {fontSize: 13, fontWeight: '500'},
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
