/**
 * Create/edit smart sort rule (spec smart-filename-sort Step 13,
 * fix-preview-redesign 重构)。
 * 正则输入支持 /pattern/flags 字面量风格（core parsePatternInput 单源）：
 * 输入框绑定原始文本 patternInput，解析结果同步进 draft.pattern/flags，
 * 测试/保存均消费解析值；正则不进全屏编辑（fix ②：正则没那么长），
 * 改为自适应高度的多行输入（textarea 式，内容增高、封顶后内部滚动）。
 * 描述字段同为自适应多行（fix-desc-and-highlight：单行看不全）。
 * 测试预览为正则匹配测试（fix ②：替代旧排序测试）：输入一段文本，
 * 点「测试」按钮手动触发（非实时联动），下方 monospace 区高亮渲染
 * 原文（匹配段 primary 变色，按 matches.index 切分，fix-desc-and-highlight）
 * + 每处匹配的提取元组小字（D13：tuple 文案，null 显「无序号」）
 * + 底部匹配计数；输入变化即清空结果（结果只属于上次点击）。
 * 规则字段 example 已更名 description（fix ④：语义泛化为描述）。
 * 捕获数字三档下拉（D13）：智能数字/固定最大/固定最小，PickerListModal
 * 值行模式（照 DirectoryRuleSheet）；固定档命中即哨兵元组、忽略捕获组。
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
  type TextInputProps,
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
  type SmartSortCaptureKind,
  type SmartSortRule,
} from '@novel-master/core/smart-sort-rule';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormSwitchRow} from '@/components/form/FormSwitchRow';
import {FormTextInput} from '@/components/form/FormTextInput';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
import {PickerListModal} from '@/components/ui/PickerListModal';
import type {PickerListLoadResult} from '@/components/ui/PickerListModal';
import {useRuntime} from '@/hooks/useRuntime';
import {useTheme} from '@/theme/ThemeProvider';
import type {ThemeTokens} from '@/theme/tokens';
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
  /** 捕获数字档位（D13）：smart 捕获组提取 / fixed_min 哨兵最前 / fixed_max 沉底。 */
  captureKind: SmartSortCaptureKind;
  description: string;
  enabled: boolean;
}

const DEFAULT_DRAFT: DraftFields = {
  name: '',
  patternInput: '',
  pattern: '',
  flags: '',
  captureKind: 'smart',
  description: '',
  enabled: true,
};

/** 捕获数字三档选项（D13）：值行下拉用，顺序与任务定稿一致。 */
const CAPTURE_KIND_OPTIONS: ReadonlyArray<{
  value: SmartSortCaptureKind;
  label: string;
}> = [
  {value: 'smart', label: '智能数字'},
  {value: 'fixed_max', label: '固定最大'},
  {value: 'fixed_min', label: '固定最小'},
];

/** 档位显示名（回显/选项高亮共用）。 */
function captureKindLabel(kind: SmartSortCaptureKind): string {
  return CAPTURE_KIND_OPTIONS.find(o => o.value === kind)?.label ?? '智能数字';
}

/** 正则输入自适应高度：单行起步，约 7 行封顶（超出内部滚动）。 */
const PATTERN_INPUT_MIN_HEIGHT = 46;
const PATTERN_INPUT_MAX_HEIGHT = 170;

/** 描述字段自适应高度：与正则同款起步，封顶略低（fix-desc-and-highlight）。 */
const DESCRIPTION_INPUT_MIN_HEIGHT = 46;
const DESCRIPTION_INPUT_MAX_HEIGHT = 120;

/** 测试结果形态：idle（未测/输入已变化）→ 手动点击后才进入 ok/error。 */
type TestOutcome =
  | {kind: 'idle'}
  | {kind: 'ok'; result: MatchSmartSortPatternResult}
  | {kind: 'error'; message: string};

const IDLE_OUTCOME: TestOutcome = {kind: 'idle'};

/** 自适应多行输入（正则/描述共用，fix-desc-and-highlight 抽出）：
 *  单行起步，内容增高即撑高，封顶后固定高度内部滚动。 */
function AutoGrowMultilineInput({
  tokens,
  value,
  onChangeText,
  placeholder,
  minHeight,
  maxHeight,
  ...rest
}: TextInputProps & {
  tokens: ThemeTokens;
  minHeight: number;
  maxHeight: number;
}) {
  const [height, setHeight] = useState<number | null>(null);
  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const contentHeight = e.nativeEvent.contentSize.height;
      setHeight(
        Math.min(Math.max(contentHeight + 24, minHeight), maxHeight),
      );
    },
    [minHeight, maxHeight],
  );
  return (
    <FormTextInput
      tokens={tokens}
      multiline
      value={value}
      onChangeText={onChangeText}
      onContentSizeChange={handleContentSizeChange}
      placeholder={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      style={[
        styles.autoGrowInput,
        {minHeight},
        height != null ? {height} : null,
      ]}
      {...rest}
    />
  );
}

/** 高亮切分段：测试原文按匹配偏移切成普通段/匹配段交替。 */
interface HighlightSegment {
  text: string;
  matched: boolean;
}

/** 按 matches（含 index）把测试文本切成普通段/匹配段交替序列：
 *  偏移来自 matchAll 原生 index，重复文本不会错位（indexOf 回查会漂）；
 *  零宽匹配跳过（不产生空匹配段，cursor 不后移）。 */
function splitHighlightSegments(
  text: string,
  matches: readonly {index: number; text: string}[],
): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.index > cursor) {
      segments.push({text: text.slice(cursor, m.index), matched: false});
    }
    if (m.text.length > 0) {
      segments.push({text: m.text, matched: true});
    }
    cursor = Math.max(cursor, m.index + m.text.length);
  }
  if (cursor < text.length) {
    segments.push({text: text.slice(cursor), matched: false});
  }
  return segments;
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
  const [captureKindPickerVisible, setCaptureKindPickerVisible] =
    useState(false);
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
    // 与保存同口径：trim 后重新解析，避免尾随空白拆坏字面量；档位随当前
    // 捕获数字选择传入（fixed 档 tuple 显哨兵文案，D13）。
    const parsed = parsePatternInput(draft.patternInput.trim());
    setTestOutcome({
      kind: 'ok',
      result: matchSmartSortPattern(
        parsed.pattern,
        parsed.flags,
        testText,
        draft.captureKind,
      ),
    });
  }, [draft.patternInput, draft.captureKind, testText]);

  const handleSave = async () => {
    const fields = collectFields();
    if (!fields) {
      return;
    }
    try {
      // 保存前走同一校验（非法正则/flags/捕获组——smart 档才强制捕获组），
      // 提示语与测试一致。
      validateSmartSortRuleDraft({
        name: fields.name,
        pattern: fields.pattern,
        flags: fields.flags,
        captureKind: fields.captureKind,
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
        captureKind: fields.captureKind,
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

  // PickerListModal 骨架要求 load 异步；静态选项每次打开以当前档位高亮。
  const loadCaptureKinds = useCallback(
    async (): Promise<
      PickerListLoadResult<{
        value: SmartSortCaptureKind;
        label: string;
      }>
    > => ({rows: [...CAPTURE_KIND_OPTIONS], selectedId: draft.captureKind}),
    [draft.captureKind],
  );

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
        hint="按优先级逐条尝试，首个命中者按捕获方式取序：智能数字从捕获组提取（须含至少一个捕获组），固定档命中即排最前/沉底。"
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
          <AutoGrowMultilineInput
            tokens={tokens}
            value={draft.patternInput}
            onChangeText={applyPatternInput}
            placeholder="如 /第([0-9〇零一二两三四五六七八九十百千]+)章/i"
            minHeight={PATTERN_INPUT_MIN_HEIGHT}
            maxHeight={PATTERN_INPUT_MAX_HEIGHT}
          />
        </FormField>
        <FormField
          label="捕获数字"
          tokens={tokens}
          hint={
            draft.captureKind === 'smart'
              ? '从捕获组提取序号，中文数字自动转换'
              : draft.captureKind === 'fixed_min'
                ? '命中即排在所有序号之前（序章/楔子类）'
                : '命中即沉底排在所有序号之后（终章/番外类）'
          }>
          <Pressable
            testID="capture-kind-value-row"
            accessibilityLabel="选择捕获数字方式"
            onPress={() => setCaptureKindPickerVisible(true)}
            style={[styles.pickerRow, {borderColor: tokens.border}]}>
            <Text
              testID="capture-kind-value"
              style={{color: tokens.text}}
              numberOfLines={1}>
              {captureKindLabel(draft.captureKind)}
            </Text>
            <Text style={[styles.chevron, {color: tokens.textTertiary}]}>
              ›
            </Text>
          </Pressable>
        </FormField>
        <FormField label="描述" tokens={tokens}>
          <AutoGrowMultilineInput
            tokens={tokens}
            value={draft.description}
            onChangeText={v => patchDraft({description: v})}
            placeholder="描述这条规则匹配什么，如 匹配 第X章 形式的标题"
            minHeight={DESCRIPTION_INPUT_MIN_HEIGHT}
            maxHeight={DESCRIPTION_INPUT_MAX_HEIGHT}
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
        hint="输入一段文本，点击「测试」后显示全部匹配与每处匹配的提取序号。"
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
              <>
                {/* 高亮渲染（fix-desc-and-highlight）：按匹配偏移把原文切
                    成普通段/匹配段，嵌套 Text 继承 monospace 样式；多行
                    文本在 Text 内自然换行。 */}
                <Text style={[styles.resultText, {color: tokens.text}]}>
                  {splitHighlightSegments(
                    testText,
                    testOutcome.result.matches,
                  ).map((seg, i) =>
                    seg.matched ? (
                      <Text key={i} style={{color: tokens.primary}}>
                        {seg.text}
                      </Text>
                    ) : (
                      <Text key={i}>{seg.text}</Text>
                    ),
                  )}
                </Text>
                {/* 每处匹配的提取元组小字（D13）：匹配文本 → tuple 展示，
                    null 显「无序号」；固定档恒显哨兵文案。 */}
                {testOutcome.result.matches.length > 0 ? (
                  <View style={styles.tupleList}>
                    {testOutcome.result.matches.map((m, i) => (
                      <Text
                        key={`${m.index}-${i}`}
                        style={[
                          styles.tupleRow,
                          {color: tokens.textSecondary},
                        ]}>
                        {`${m.text || '(空匹配)'} → ${
                          m.tuple ?? '无序号'
                        }`}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <Text
                  style={[styles.resultCount, {color: tokens.textSecondary}]}>
                  {testOutcome.result.matches.length > 0
                    ? `共 ${testOutcome.result.matches.length} 处匹配`
                    : '无匹配'}
                </Text>
              </>
            ) : (
              <Text style={[styles.resultText, {color: tokens.danger}]}>
                {`正则无效：${testOutcome.result.error}`}
              </Text>
            )}
          </View>
        </FormField>
      </FormSectionCard>

      {/* 捕获数字单选：独立底部弹层（RN Modal 叠层），选中即关（D13）。 */}
      <PickerListModal
        visible={captureKindPickerVisible}
        title="捕获数字"
        load={loadCaptureKinds}
        keyExtractor={item => item.value}
        renderRow={(item, selected) => (
          <>
            <Text style={{color: tokens.text}}>{item.label}</Text>
            {selected ? (
              <Text style={{color: tokens.primary}}>当前</Text>
            ) : null}
          </>
        )}
        getRowProps={item => ({
          testID: `capture-kind-option-${item.value}`,
          accessibilityLabel: `捕获数字 ${item.label}`,
        })}
        onPick={item => {
          patchDraft({captureKind: item.value});
          setCaptureKindPickerVisible(false);
        }}
        emptyText="暂无可选捕获方式"
        onClose={() => setCaptureKindPickerVisible(false)}
      />
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
    captureKind: rule.captureKind,
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
  autoGrowInput: {
    textAlignVertical: 'top',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  chevron: {
    fontSize: 18,
    marginLeft: 8,
  },
  tupleList: {
    marginTop: 8,
    gap: 2,
  },
  tupleRow: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
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
  resultCount: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
});
