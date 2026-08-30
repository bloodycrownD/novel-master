/**
 * 工具白名单/黑名单选择器：trigger 行 + 底部 sheet 多选。
 *
 * 改造前是搜索框 + 全量列表永久常驻、勾选用 Unicode ☑/☐，
 * 与表单里 FormSelectField 的底部 sheet 风格不一致。
 * 现在拆成 trigger（Pressable row，文案「白名单工具：N/总数 ▼」）
 * 和底部 sheet（搜索 + 多选列表 + 确定/取消），复用 FormOverlayHost 顶起，
 * 选中行样式对齐 FormSelectField（行背景高亮 + 右侧 ✓）。
 *
 * 行为差异（相对 FormSelectField 的单选）：
 * - 点行只 toggle 临时 draft，不关闭 sheet；点确定才把 draft 提交回 onChange 并关闭。
 * - draft 仅在 open 从 false 翻 true 时用 selected 初始化一次，sheet 打开期间不再随 selected 变化重置。
 */
import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import Animated from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {BUILTIN_TOOL_CATALOG} from '@novel-master/core/config-forms/agent';
import {FormTextInput} from '@/components/form/FormTextInput';
import {useFormOverlay} from '@/components/form/FormOverlayHost';
import {useAdaptiveKeyboardSheetStyle} from '@/hooks/useAdaptiveKeyboardSheetStyle';
import type {ThemeTokens} from '@/theme/tokens';

type Props = {
  tokens: ThemeTokens;
  selected: readonly string[];
  onChange: (selected: string[]) => void;
};

const TOTAL = BUILTIN_TOOL_CATALOG.length;

/** 根据 toolsMode 的语义把 label 里「白名单/黑名单」前缀传进来更准，但调用方目前两种都用本组件，统一显示「工具」。 */
function buildTriggerLabel(selected: readonly string[]): string {
  if (selected.length === 0) {
    return `未选择工具（0/${TOTAL}）`;
  }
  if (selected.length >= TOTAL) {
    return `全部工具（${TOTAL}/${TOTAL}）`;
  }
  return `已选工具（${selected.length}/${TOTAL}）`;
}

export function ToolPolicyPicker({tokens, selected, onChange}: Props) {
  const overlay = useFormOverlay();
  const overlayKey = useId();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<readonly string[]>(selected);
  const [query, setQuery] = useState('');

  // draft 仅在 sheet 从关闭翻到打开的那一刻用 selected 初始化一次；
  // 打开期间 selected 即便变了也不重置（避免外部改动把用户正在勾的草稿冲掉）。
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDraft(selected);
      setQuery('');
    }
    prevOpenRef.current = open;
  }, [open, selected]);

  const draftSet = useMemo(() => new Set(draft), [draft]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') {
      return BUILTIN_TOOL_CATALOG;
    }
    return BUILTIN_TOOL_CATALOG.filter(
      item =>
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q),
    );
  }, [query]);

  const toggle = useCallback(
    (name: string) => {
      if (draftSet.has(name)) {
        setDraft(draft.filter(n => n !== name));
      } else {
        setDraft([...draft, name]);
      }
    },
    [draftSet, draft],
  );

  const close = useCallback(() => setOpen(false), []);

  const confirm = useCallback(() => {
    onChange([...draft]);
    close();
  }, [onChange, draft, close]);

  const triggerLabel = buildTriggerLabel(selected);

  // 键盘避让（上移 + maxHeight 收缩）由公共 hook 统一处理：
  // FormOverlayHost 是普通 View 渲染层无任何避让，iOS 也要并 iosTranslateY
  // 让 hook 自己 translateY，否则面板底部被键盘盖住 kb 高度、顶部留 kb 空隙。
  const panelAvoidStyle = useAdaptiveKeyboardSheetStyle(0.75, {
    iosTranslateY: true,
  });

  useEffect(() => {
    if (!open || !overlay) {
      overlay?.hide(overlayKey);
      return;
    }

    overlay.show(
      overlayKey,
      <Pressable style={styles.backdrop} onPress={close}>
        <Animated.View
          style={[
            styles.sheet,
            {backgroundColor: tokens.surface},
            panelAvoidStyle,
          ]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[styles.sheetTitle, {color: tokens.text}]}>
            选择工具
          </Text>
          <View style={styles.searchWrap}>
            <FormTextInput
              tokens={tokens}
              value={query}
              onChangeText={setQuery}
              placeholder="搜索工具…"
            />
          </View>
          <FlatList
            data={filtered}
            keyExtractor={item => item.name}
            style={styles.list}
            renderItem={({item}) => {
              const active = draftSet.has(item.name);
              return (
                <Pressable
                  style={[
                    styles.row,
                    {borderBottomColor: tokens.border},
                    active && {backgroundColor: tokens.bgSecondary},
                  ]}
                  onPress={() => toggle(item.name)}
                >
                  <View style={styles.rowText}>
                    <Text style={{color: tokens.text}}>{item.name}</Text>
                    <Text style={{color: tokens.textSecondary, fontSize: 13}}>
                      {item.description}
                    </Text>
                  </View>
                  {active ? (
                    <Text style={{color: tokens.primary}}>✓</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
          <View
            style={[
              styles.actionRow,
              {
                borderTopColor: tokens.border,
                paddingBottom: Math.max(insets.bottom, 16),
              },
            ]}
          >
            <Pressable onPress={close} style={styles.actionBtn}>
              <Text style={{color: tokens.textSecondary}}>取消</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              style={[styles.actionBtn, {backgroundColor: tokens.primary}]}
            >
              <Text style={styles.confirmText}>确定</Text>
            </Pressable>
          </View>
        </Animated.View>
      </Pressable>,
    );

    return () => overlay.hide(overlayKey);
  }, [
    open,
    overlay,
    overlayKey,
    filtered,
    draft,
    draftSet,
    query,
    tokens,
    insets.bottom,
    close,
    confirm,
    toggle,
  ]);

  return (
    <Pressable
      style={[
        styles.trigger,
        {
          backgroundColor: tokens.bgSecondary,
          borderColor: tokens.borderLight,
        },
      ]}
      onPress={() => setOpen(true)}
    >
      <Text
        style={{
          color: selected.length > 0 ? tokens.text : tokens.textSecondary,
          flex: 1,
        }}
        numberOfLines={1}
      >
        {triggerLabel}
      </Text>
      <Text style={{color: tokens.textSecondary, fontSize: 12}}>▼</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    // maxHeight（含键盘收缩）由 useAdaptiveKeyboardSheetStyle 管
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingTop: 8,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 12,
  },
  searchWrap: {paddingHorizontal: 16, paddingBottom: 8},
  list: {maxHeight: 320, flexShrink: 1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rowText: {flex: 1, gap: 2},
  actionRow: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  confirmText: {color: '#fff', fontWeight: '600'},
});
