/**
 * Create/edit smart sort rule (spec smart-filename-sort Step 13,
 * fix-preview-redesign 重构)。
 * 正则输入支持 /pattern/flags 字面量风格（core PatternInput.parse 单源）：
 * 输入框绑定原始文本 patternInput，解析结果同步进 draft.pattern/flags，
 * 测试/保存均消费解析值；正则不进全屏编辑（fix ②：正则没那么长），
 * 改为自适应高度的多行输入（textarea 式，内容增高、封顶后内部滚动）。
 * 描述字段同为自适应多行（fix-desc-and-highlight：单行看不全）。
 * 测试预览为正则匹配测试（fix ②：替代旧排序测试）：输入一段文本，
 * 点「测试」按钮手动触发（非实时联动），下方 monospace 区高亮渲染
 * 原文（匹配段 primary 变色，按 matches.index 切分——core 单源
 * SmartSortHighlight.splitSegments，fix-desc-and-highlight）
 * + 每处匹配的提取元组小字（D13：tuple 文案，null 显「无序号」）
 * + 底部匹配计数；测试文本/正则/捕获档位任一变化即清空结果
 * （结果只属于上次点击「测试」时的输入快照，dtcli/B-1）。
 * 规则字段 example 已更名 description（fix ④：语义泛化为描述）。
 * 捕获数字三档下拉（D13）：智能数字/固定最大/固定最小，PickerListModal
 * 值行模式（照 DirectoryRuleSheet）；固定档命中即哨兵元组、忽略捕获组。
 */
import {Result, AppError} from '@novel-master/core/errors';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {ActivityIndicator, Pressable, StyleSheet, Text, View, type NativeSyntheticEvent, type TextInputContentSizeChangeEventData, type TextInputProps} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import type {RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {
  PatternInput,
  SmartSortHighlight,
  SmartSortPattern,
  SmartSortRule,
  SmartSortRuleCompiler,
  type MatchSmartSortPatternResult,
  type SmartSortCaptureKind,
} from '@novel-master/core/smart-sort-rule';
import {FormField} from '@/components/form/FormField';
import {FormSectionCard} from '@/components/form/FormSectionCard';
import {FormSwitchRow} from '@/components/form/FormSwitchRow';
import {FormTextInput} from '@/components/form/FormTextInput';
import {HelpSection} from '@/components/common/HelpSection';
import {ScreenFormLayout} from '@/components/form/ScreenFormLayout';
import {StickyFormFooter} from '@/components/form/StickyFormFooter';
import {SecondaryButton} from '@/components/ui/Buttons';
import {PickerListModal} from '@/components/ui/PickerListModal';
import type {PickerListLoadResult} from '@/components/ui/PickerListModal';
import {useRuntime} from '@/hooks/useRuntime';
import {useStackOverrideSetter} from '@/navigation/HeaderContext';
import {HelpIcon} from '@/components/icons/TabIcons';
import {ModalShell} from '@/components/ui/ModalShell';
import {useTheme} from '@/theme/ThemeProvider';
import type {ThemeTokens} from '@/theme/tokens';
import {useToast} from '@/components/chrome/ToastHost';
import {ToastMessage} from '@/errors/toast-message';
import {coreT} from '@/i18n/core';
import {useUnsavedGuard} from '@/hooks/useUnsavedGuard';
import type {RootStackParamList} from '@/navigation/types';

type EditorRoute = RouteProp<RootStackParamList, 'SmartSortRuleEditor'>;
type StackNav = NativeStackNavigationProp<RootStackParamList>;

interface DraftFields {
  name: string;
  /** 正则输入框原始文本（可能是 /pattern/flags 字面量风格）。 */
  patternInput: string;
  /** PatternInput.parse(patternInput) 的解析结果（测试/保存消费）。 */
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
  {value: 'smart', label: coreT({key: "ui.smart_sort.capture_kind_smart"})},
  {value: 'fixed_max', label: coreT({key: "ui.smart_sort.capture_kind_fixed_max"})},
  {value: 'fixed_min', label: coreT({key: "ui.smart_sort.capture_kind_fixed_min"})},
];

/** 档位显示名（回显/选项高亮共用）。 */
function captureKindLabel(kind: SmartSortCaptureKind): string {
  return CAPTURE_KIND_OPTIONS.find(o => o.value === kind)?.label ?? coreT({key: "ui.smart_sort.capture_kind_smart"});
}

/** 正则输入自适应高度：单行起步，约 7 行封顶（超出内部滚动）。 */
const PATTERN_INPUT_MIN_HEIGHT = 46;
const PATTERN_INPUT_MAX_HEIGHT = 170;

/** 描述字段自适应高度：与正则同款起步，封顶略低（fix-desc-and-highlight）。 */
const DESCRIPTION_INPUT_MIN_HEIGHT = 46;
const DESCRIPTION_INPUT_MAX_HEIGHT = 120;

/** 测试结果形态：idle（未测/输入已变化）→ 手动点击后才进入 ok/error。 */
type TestOutcome = {kind: 'idle'} | {kind: 'ok'; result: MatchSmartSortPatternResult} | {kind: 'error'; message: string};

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
      setHeight(Math.min(Math.max(contentHeight + 24, minHeight), maxHeight));
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
      style={[styles.autoGrowInput, {minHeight}, height != null ? {height} : null]}
      {...rest}
    />
  );
}

export function SmartSortRuleEditorScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  // 屏级 override：自动带 ownerRouteKey，转场期间不泄漏到相邻屏 header。
  const setStackOverride = useStackOverrideSetter();
  const navigation = useNavigation<StackNav>();
  const route = useRoute<EditorRoute>();
  const ruleId = route.params?.ruleId;
  /** 使用说明弹窗（标题栏「?」按钮，照搜索配置同款）。 */
  const [helpVisible, setHelpVisible] = useState(false);

  // 标题栏菜单位换「?」帮助按钮（照 SearchEnginesScreen 先例；useFocusEffect
  // 保证其它屏覆盖/返回后重新聚焦时按钮不丢，卸载时一并关闭帮助弹窗）。
  const onScreenFocus = useCallback(() => {
    setStackOverride({
      showMenu: true,
      menuIcon: <HelpIcon color={tokens.text} />,
      onMenu: () => setHelpVisible(true),
    });
    return () => {
      setStackOverride(undefined);
      setHelpVisible(false);
    };
  }, [setStackOverride, tokens.text]);
  useFocusEffect(onScreenFocus);

  const [draft, setDraft] = useState<DraftFields>(DEFAULT_DRAFT);
  const [testText, setTestText] = useState('');
  const [testOutcome, setTestOutcome] = useState<TestOutcome>(IDLE_OUTCOME);
  const [captureKindPickerVisible, setCaptureKindPickerVisible] = useState(false);
  const [loading, setLoading] = useState(Boolean(ruleId));
  const [saving, setSaving] = useState(false);
  // baseline 初始即对齐 DEFAULT_DRAFT 快照：加载中与加载失败（catch 只 toast，
  // draft 停在 DEFAULT_DRAFT）都不产生伪 dirty——返回时不误弹「未保存的更改」；
  // 失败后用户再编辑仍正常计 dirty（mobile/B-1）。
  const [baseline, setBaseline] = useState(() => JSON.stringify(DEFAULT_DRAFT));

  const snapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = snapshot !== baseline;
  const {allowLeaveWithoutPrompt} = useUnsavedGuard(dirty);

  const patchDraft = (patch: Partial<DraftFields>) => {
    setDraft(prev => ({...prev, ...patch}));
  };

  // 输入框文本同步解析为 pattern/flags（非法字面量自动当裸 pattern）；
  // 正则变了旧结果就不再属于当前输入，照 changeTestText 范式一并清空
  // （dtcli/B-1：结果只属于上次点击「测试」时的输入快照）。
  const applyPatternInput = useCallback((text: string) => {
    setDraft(prev => ({...prev, patternInput: text, ...PatternInput.parse(text)}));
    setTestOutcome(IDLE_OUTCOME);
  }, []);

  const load = useCallback(async () => {
    if (!ruleId) {
      // 新建规则：baseline 已在 useState 初始化对齐 DEFAULT_DRAFT。
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // service 只提供 listRules；单条按 id 查找（列表量级小）。
      const rules = await runtime.smartSortRule.listRules();
      const rule = rules.find(r => r.ruleId === ruleId);
      if (!rule) {
        showToast(coreT({key: "ui.smart_sort.missing_toast"}));
        navigation.goBack();
        return;
      }
      const loaded = toDraft(rule);
      setDraft(loaded);
      setBaseline(JSON.stringify(loaded));
    } catch (error) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.load_failed"}), error));
    } finally {
      setLoading(false);
    }
  }, [runtime, ruleId, navigation, showToast]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const collectFields = (): DraftFields | null => {
    if (!draft.name.trim()) {
      showToast(coreT({key: "ui.smart_sort.name_required"}));
      return null;
    }
    if (!draft.patternInput.trim()) {
      showToast(coreT({key: "ui.smart_sort.regex_required"}));
      return null;
    }
    // 保存前以 trim 后的输入重新解析（避免尾随空白把字面量拆成裸 pattern）。
    const parsed = PatternInput.parse(draft.patternInput.trim());
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
      setTestOutcome({kind: 'error', message: coreT({key: "ui.smart_sort.regex_required"})});
      return;
    }
    // 与保存同口径：trim 后重新解析，避免尾随空白拆坏字面量；档位随当前
    // 捕获数字选择传入（fixed 档 tuple 显哨兵文案，D13）。
    const parsed = PatternInput.parse(draft.patternInput.trim());
    setTestOutcome({
      kind: 'ok',
      result: SmartSortPattern.match(parsed.pattern, parsed.flags, testText, draft.captureKind),
    });
  }, [draft.patternInput, draft.captureKind, testText]);

  const handleSave = async () => {
    const fields = collectFields();
    if (!fields) {
      return;
    }
    // 保存前走同一校验（非法正则/flags/捕获组——smart 档才强制捕获组），
    // 提示语与测试一致；校验失败走 Result 收口（错误通道迁移四期）。
    const draftCheck = SmartSortRuleCompiler.validateDraft({
      name: fields.name,
      pattern: fields.pattern,
      flags: fields.flags,
      captureKind: fields.captureKind,
    });
    if (!draftCheck.ok) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.cannot_save"}), draftCheck.error));
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
      showToast(coreT({key: "ui.smart_sort.saved_done"}));
      allowLeaveWithoutPrompt();
      navigation.goBack();
    } catch (error) {
      showToast(ToastMessage.toast(coreT({key: "ui.common.save_failed"}), error));
    } finally {
      setSaving(false);
    }
  };

  // PickerListModal 骨架要求 load 异步；静态选项每次打开以当前档位高亮。
  const loadCaptureKinds = useCallback(
    async (): Promise<
      Result<
        PickerListLoadResult<{
          value: SmartSortCaptureKind;
          label: string;
        }>,
        AppError
      >
    > => Result.ok({rows: [...CAPTURE_KIND_OPTIONS], selectedId: draft.captureKind}),
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
          {dirty ? <Text style={[styles.unsaved, {color: tokens.danger}]}>{coreT({key: "ui.common.unsaved_changes"})}</Text> : null}
          <StickyFormFooter tokens={tokens} label={coreT({key: "ui.common.save"})} loading={saving} onPress={() => handleSave().catch(() => undefined)} />
        </View>
      }
    >
      <FormSectionCard tokens={tokens}>
        <FormSwitchRow tokens={tokens} label={coreT({key: "ui.smart_sort.enable_label"})} value={draft.enabled} onValueChange={v => patchDraft({enabled: v})} />
        <FormField label={coreT({key: "ui.common.name"})} tokens={tokens}>
          <FormTextInput tokens={tokens} value={draft.name} onChangeText={v => patchDraft({name: v})} placeholder={coreT({key: "ui.smart_sort.name_example"})} />
        </FormField>
        <FormField label={coreT({key: "ui.smart_sort.regex_label"})} tokens={tokens} hint={coreT({key: "ui.smart_sort.regex_hint"})}>
          <AutoGrowMultilineInput
            tokens={tokens}
            value={draft.patternInput}
            onChangeText={applyPatternInput}
            placeholder={coreT({key: "ui.smart_sort.regex_example"})}
            minHeight={PATTERN_INPUT_MIN_HEIGHT}
            maxHeight={PATTERN_INPUT_MAX_HEIGHT}
          />
        </FormField>
        <FormField
          label={coreT({key: "ui.smart_sort.capture_label"})}
          tokens={tokens}
          hint={
            draft.captureKind === 'smart'
              ? coreT({key: "ui.smart_sort.capture_smart_hint"})
              : draft.captureKind === 'fixed_min'
              ? coreT({key: "ui.smart_sort.capture_hint_before"})
              : coreT({key: "ui.smart_sort.capture_hint_after"})
          }
        >
          <Pressable
            testID="capture-kind-value-row"
            accessibilityLabel={coreT({key: "ui.smart_sort.capture_picker_title"})}
            onPress={() => setCaptureKindPickerVisible(true)}
            style={[styles.pickerRow, {borderColor: tokens.border, backgroundColor: tokens.bgSecondary}]}
          >
            <Text testID="capture-kind-value" style={{color: tokens.text}} numberOfLines={1}>
              {captureKindLabel(draft.captureKind)}
            </Text>
            <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
          </Pressable>
        </FormField>
        <FormField label={coreT({key: "ui.common.description"})} tokens={tokens}>
          <AutoGrowMultilineInput
            tokens={tokens}
            value={draft.description}
            onChangeText={v => patchDraft({description: v})}
            placeholder={coreT({key: "ui.smart_sort.desc_hint"})}
            minHeight={DESCRIPTION_INPUT_MIN_HEIGHT}
            maxHeight={DESCRIPTION_INPUT_MAX_HEIGHT}
          />
        </FormField>
      </FormSectionCard>

      <FormSectionCard title={coreT({key: "ui.common.test"})} tokens={tokens} hint={coreT({key: "ui.smart_sort.test_hint_mobile"})}>
        <FormField label={coreT({key: "ui.smart_sort.test_text_label"})} tokens={tokens}>
          <FormTextInput tokens={tokens} multiline value={testText} onChangeText={changeTestText} placeholder={coreT({key: "ui.smart_sort.test_text_placeholder"})} />
        </FormField>
        <SecondaryButton label={coreT({key: "ui.common.test"})} tokens={tokens} onPress={runMatchTest} fullWidth />
        <FormField label={coreT({key: "ui.common.result"})} tokens={tokens}>
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
              <Text style={[styles.resultText, {color: tokens.textSecondary}]}>{coreT({key: "ui.smart_sort.result_pending"})}</Text>
            ) : testOutcome.kind === 'error' ? (
              <Text style={[styles.resultText, {color: tokens.danger}]}>{testOutcome.message}</Text>
            ) : testOutcome.result.ok ? (
              <>
                {/* 高亮渲染（fix-desc-and-highlight）：core 单源切分
                    （SmartSortHighlight.splitSegments）按匹配偏移把原文切
                    成普通段/匹配段，嵌套 Text 继承 monospace 样式；多行
                    文本在 Text 内自然换行。 */}
                <Text style={[styles.resultText, {color: tokens.text}]}>
                  {SmartSortHighlight.splitSegments(testText, testOutcome.result.matches).map((seg, i) =>
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
                      <Text key={`${m.index}-${i}`} style={[styles.tupleRow, {color: tokens.textSecondary}]}>
                        {`${m.text || coreT({key: "ui.smart_sort.no_match_text"})} → ${m.tuple ?? coreT({key: "ui.smart_sort.no_tuple"})}`}
                      </Text>
                    ))}
                  </View>
                ) : null}
                <Text style={[styles.resultCount, {color: tokens.textSecondary}]}>{testOutcome.result.matches.length > 0 ? coreT({key: "ui.smart_sort.match_count", params: {count: testOutcome.result.matches.length}}) : coreT({key: "ui.smart_sort.no_matches"})}</Text>
              </>
            ) : (
              <Text style={[styles.resultText, {color: tokens.danger}]}>{coreT({key: "ui.smart_sort.regex_invalid", params: {detail: testOutcome.result.error}})}</Text>
            )}
          </View>
        </FormField>
      </FormSectionCard>

      {/* 捕获数字单选：独立底部弹层（RN Modal 叠层），选中即关（D13）。 */}
      <PickerListModal
        visible={captureKindPickerVisible}
        title={coreT({key: "ui.smart_sort.capture_label"})}
        load={loadCaptureKinds}
        keyExtractor={item => item.value}
        renderRow={(item, selected) => (
          <>
            <Text style={{color: tokens.text}}>{item.label}</Text>
            {selected ? <Text style={{color: tokens.primary}}>{coreT({key: "ui.common.current"})}</Text> : null}
          </>
        )}
        getRowProps={item => ({
          testID: `capture-kind-option-${item.value}`,
          accessibilityLabel: coreT({key: "ui.smart_sort.capture_aria", params: {label: item.label}}),
        })}
        onPick={item => {
          // 档位影响 tuple 提取，旧结果同样失效（dtcli/B-1，照 changeTestText 范式）。
          patchDraft({captureKind: item.value});
          setTestOutcome(IDLE_OUTCOME);
          setCaptureKindPickerVisible(false);
        }}
        emptyText={coreT({key: "ui.smart_sort.capture_empty"})}
        onClose={() => setCaptureKindPickerVisible(false)}
      />
      {/* 使用说明弹窗：规则优先级 / 智能数字 / 固定档 / 正则格式四段，照搜索配置同款。 */}
      <ModalShell visible={helpVisible} onClose={() => setHelpVisible(false)} variant="center" animationType="fade" panelStyle={styles.helpPanel}>
        <Text style={[styles.helpTitle, {color: tokens.text}]}>{coreT({key: "ui.smart_sort.help_title"})}</Text>
        <HelpSection tokens={tokens} title={coreT({key: "ui.smart_sort.help_priority_title"})} body={coreT({key: "ui.smart_sort.help_priority_body"})} />
        <HelpSection tokens={tokens} title={coreT({key: "ui.smart_sort.help_smart_title"})} body={coreT({key: "ui.smart_sort.help_smart_body"})} />
        <HelpSection tokens={tokens} title={coreT({key: "ui.smart_sort.help_fixed_title"})} body={coreT({key: "ui.smart_sort.help_fixed_body"})} />
        <HelpSection tokens={tokens} title={coreT({key: "ui.smart_sort.help_regex_title"})} body={coreT({key: "ui.smart_sort.help_regex_body"})} />
        <Pressable onPress={() => setHelpVisible(false)} style={[styles.helpCloseRow, {borderTopColor: tokens.border}]}>
          <Text style={{color: tokens.primary, fontSize: 15}}>{coreT({key: "ui.common.close"})}</Text>
        </Pressable>
      </ModalShell>
    </ScreenFormLayout>
  );
}

function toDraft(rule: SmartSortRule): DraftFields {
  return {
    name: rule.name,
    // 回显：pattern+flags 拼回 /pattern/flags 字面量风格（flags 空则 /pattern/），
    // 再解析回同一 pattern/flags（core 单测保障 round-trip）。
    patternInput: PatternInput.format(rule.pattern, rule.flags),
    pattern: rule.pattern,
    flags: rule.flags,
    captureKind: rule.captureKind,
    description: rule.description ?? '',
    enabled: rule.enabled,
  };
}

const styles = StyleSheet.create({
  helpPanel: {
    borderRadius: 16,
    width: '100%',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  helpTitle: {fontSize: 17, fontWeight: '600', marginBottom: 14},
  helpCloseRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
    paddingVertical: 10,
    alignItems: 'center',
  },
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
