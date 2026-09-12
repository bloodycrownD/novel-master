/**
 * Create/edit smart sort rule (spec smart-filename-sort Step 13,
 * fix-preview-redesign 重构)。
 * 正则输入支持 /pattern/flags 字面量风格（core parsePatternInput 单源）：
 * 输入框绑定原始文本 patternInput，解析结果同步进 draft.pattern/flags，
 * 测试/保存均消费解析值；正则不进全屏编辑（fix ②：正则没那么长），
 * 改为自适应高度的多行输入（textarea 式，内容增高、封顶后内部滚动）。
 * 测试预览为正则匹配测试（fix ②：替代旧排序测试）：输入一段文本，
 * 点「测试」按钮手动触发（非实时联动），下方 monospace 区逐匹配显示
 * 文本与捕获组；输入变化即清空结果（结果只属于上次点击）。
 * 规则字段 example 已更名 description（fix ④：语义泛化为描述）。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  formatPatternInput,
  matchSmartSortPattern,
  parsePatternInput,
  validateSmartSortRuleDraft,
  type MatchSmartSortPatternResult,
  type SmartSortRule,
} from '@novel-master/core/smart-sort-rule';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormSwitchRow} from '@/components/form/FormSwitchRow';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
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
  /** parsePatternInput(patternInput) 的解析结果（测试/保存消费）。 */
  pattern: string;
  flags: string;
  description: string;
  enabled: boolean;
}

const DEFAULT_DRAFT: DraftFields = {
  name: '',
  patternInput: '',
  pattern: '',
  flags: '',
  description: '',
  enabled: true,
};

/** 正则输入自适应高度：单行起步，约 7 行封顶（超出内部滚动）。 */
const PATTERN_INPUT_MIN_HEIGHT = 46;
const PATTERN_INPUT_MAX_HEIGHT = 170;

/** 测试结果形态：idle（未测/输入已变化）→ 手动点击后才进入 ok/error。 */
type TestOutcome =
  | {kind: 'idle'}
  | {kind: 'ok'; result: MatchSmartSortPatternResult}
  | {kind: 'error'; message: string};

const IDLE_OUTCOME: TestOutcome = {kind: 'idle'};

/** 匹配行渲染：匹配文本带引号，捕获组逐组列出（未参与匹配为 '-'）。 */
function formatMatchLine(match: {
  text: string;
  groups: readonly (string | null)[];
}): string {
  const groups = match.groups.map(g => (g == null ? '-' : JSON.stringify(g)));
  return `${JSON.stringify(match.text)}  [${groups.join(', ')}]`;
}

export function SmartSortRuleEditorScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<StackNav>();
  const route = useRoute<EditorRoute>();
  const ruleId = route.params?.ruleId;

  const [draft, setDraft] = useState<DraftFields>(DEFAULT_DRAFT);
  const [testText, setTestText] = useState('');
  const [testOutcome, setTestOutcome] = useState<TestOutcome>(IDLE_OUTCOME);
  const [patternInputHeight, setPatternInputHeight] = useState<number | null>(
    null,
  );
  const [loading, setLoading] = useState(Boolean(ruleId));
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState('');

  const snapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = snapshot !== baseline;
  const {allowLeaveWithoutPrompt} = useUnsavedGuard(dirty);

  const patchDraft = (patch: Partial<DraftFields>) => {
    setDraft(prev => ({...prev, ...patch}));
  };

  // 输入框文本同步解析为 pattern/flags（非法字面量自动当裸 pattern）。
  const applyPatternInput = useCallback((text: string) => {
    setDraft(prev => ({...prev, patternInput: text, ...parsePatternInput(text)}));
  }, []);

  // 自适应高度：内容增高即撑高输入框，封顶后固定高度内部滚动。
  const handlePatternContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const contentHeight = e.nativeEvent.contentSize.height;
      setPatternInputHeight(
        Math.min(
          Math.max(contentHeight + 24, PATTERN_INPUT_MIN_HEIGHT),
          PATTERN_INPUT_MAX_HEIGHT,
        ),
      );
    },
    [],
  );

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
      description: draft.description.trim(),
    };
  };

  // ---- 正则匹配测试（fix ②：按钮手动触发，替代旧实时排序预览） ----

  // 输入变化清空结果区：结果只属于上次点击「测试」时的输入快照。
  const changeTestText = useCallback((v: string) => {
    setTestText(v);
    setTestOutcome(IDLE_OUTCOME);
  }, []);

  const runMatchTest = useCallback(() => {
    if (!draft.patternInput.trim()) {
      setTestOutcome({kind: 'error', message: '请先填写正则表达式'});
      return;
    }
    // 与保存同口径：trim 后重新解析，避免尾随空白拆坏字面量。
    const parsed = parsePatternInput(draft.patternInput.trim());
    setTestOutcome({kind: 'ok', result: matchSmartSortPattern(parsed.pattern, parsed.flags, testText)});
  }, [draft.patternInput, testText]);

  const handleSave = async () => {
    const fields = collectFields();
    if (!fields) {
      return;
    }
    try {
      // 保存前走同一校验（非法正则/flags/捕获组），提示语与测试一致。
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
        description: fields.description === '' ? null : fields.description,
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
            multiline
            value={draft.patternInput}
            onChangeText={applyPatternInput}
            onContentSizeChange={handlePatternContentSizeChange}
            placeholder="如 /第([0-9〇零一二两三四五六七八九十百千]+)章/i"
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.patternInput,
              patternInputHeight != null
                ? {height: patternInputHeight}
                : null,
            ]}
          />
        </FormField>
        <FormField label="描述" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            value={draft.description}
            onChangeText={v => patchDraft({description: v})}
            placeholder="描述这条规则匹配什么，如 匹配 第X章 形式的标题"
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
        title="测试"
        tokens={tokens}
        hint="输入一段文本，点击「测试」后显示全部匹配与捕获组。"
      >
        <FormField label="测试文本" tokens={tokens}>
          <FormTextInput
            tokens={tokens}
            multiline
            value={testText}
            onChangeText={changeTestText}
            placeholder="输入测试文本"
          />
        </FormField>
        <SecondaryButton
          label="测试"
          tokens={tokens}
          onPress={runMatchTest}
          fullWidth
        />
        <FormField label="结果" tokens={tokens}>
          <View
            style={[
              styles.resultBox,
              {
                backgroundColor: tokens.bgSecondary,
                borderColor: tokens.borderLight,
              },
            ]}
          >
            {testOutcome.kind === 'idle' ? (
              <Text style={[styles.resultText, {color: tokens.textSecondary}]}>
                点击「测试」查看匹配结果
              </Text>
            ) : testOutcome.kind === 'error' ? (
              <Text style={[styles.resultText, {color: tokens.danger}]}>
                {testOutcome.message}
              </Text>
            ) : testOutcome.result.ok ? (
              testOutcome.result.matches.length === 0 ? (
                <Text style={[styles.resultText, {color: tokens.textSecondary}]}>
                  无匹配
                </Text>
              ) : (
                <Text style={[styles.resultText, {color: tokens.text}]}>
                  {testOutcome.result.matches.map(formatMatchLine).join('\n')}
                </Text>
              )
            ) : (
              <Text style={[styles.resultText, {color: tokens.danger}]}>
                {`正则无效：${testOutcome.result.error}`}
              </Text>
            )}
          </View>
        </FormField>
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

function toDraft(rule: SmartSortRule): DraftFields {
  return {
    name: rule.name,
    // 回显：pattern+flags 拼回 /pattern/flags 字面量风格（flags 空则 /pattern/），
    // 再解析回同一 pattern/flags（core 单测保障 round-trip）。
    patternInput: formatPatternInput(rule.pattern, rule.flags),
    pattern: rule.pattern,
    flags: rule.flags,
    description: rule.description ?? '',
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
  patternInput: {
    minHeight: PATTERN_INPUT_MIN_HEIGHT,
    textAlignVertical: 'top',
  },
  resultBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    minHeight: 56,
  },
  resultText: {
    fontFamily: 'monospace',
    fontSize: 14,
    lineHeight: 20,
  },
});
