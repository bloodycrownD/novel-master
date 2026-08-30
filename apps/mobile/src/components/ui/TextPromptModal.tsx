/**
 * 单/双输入文本弹窗（新建/重命名/添加模型等，cr-fix-spec comp-rest/C-2）：
 * variant center 居中卡片，bottom 贴底 sheet（吸收原 EditModelNameModal 与
 * AddModelModal）。1–2 个输入，必填项 trim 非空才能提交，提交期间禁用按钮，
 * onConfirm 正常返回（不 throw）后自动关闭。
 */
import React, {useEffect, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {ModalShell} from './ModalShell';

export type PromptField = {
  label?: string;
  placeholder?: string;
  initialValue?: string;
  /** 选填：留空不阻塞提交（回抛空串，由调用方转 undefined）。 */
  optional?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
};

type Props = {
  visible: boolean;
  title: string;
  /** center 居中卡片（默认）；bottom 贴底 sheet。 */
  variant?: 'center' | 'bottom';
  /** 单字段语法糖：等价于 fields 的单元素简写。 */
  label?: string;
  placeholder?: string;
  initialValue?: string;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  /** 1–2 个输入；不传时按上面的单字段语法糖构造。 */
  fields?: [PromptField] | [PromptField, PromptField];
  confirmLabel?: string;
  onClose: () => void;
  /** 按字段顺序回抛 trim 后的值。 */
  onConfirm: (values: string[]) => void | Promise<void>;
};

export function TextPromptModal({
  visible,
  title,
  variant = 'center',
  label,
  placeholder,
  initialValue = '',
  autoCapitalize,
  fields,
  confirmLabel = '确定',
  onClose,
  onConfirm,
}: Props) {
  const {tokens} = useTheme();
  const effectiveFields: PromptField[] = fields ?? [
    {label, placeholder, initialValue, autoCapitalize},
  ];
  const [values, setValues] = useState<string[]>(() =>
    effectiveFields.map(field => field.initialValue ?? ''),
  );
  const [saving, setSaving] = useState(false);

  // 重置只随可见性与初始值变化；effectiveFields 是每次渲染的新数组，
  // 不能直接进依赖（否则每次渲染都把输入冲掉）。
  const initialKey = effectiveFields
    .map(field => field.initialValue ?? '')
    .join('\0');
  useEffect(() => {
    if (visible) {
      setValues(effectiveFields.map(field => field.initialValue ?? ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialKey 是 effectiveFields 初始值的稳定摘要
  }, [visible, initialKey]);

  const trimmed = values.map(value => value.trim());
  const canSubmit =
    !saving &&
    effectiveFields.every(
      (field, index) => field.optional || trimmed[index].length > 0,
    );

  const handleConfirm = async () => {
    if (!canSubmit) {
      return;
    }
    setSaving(true);
    try {
      await onConfirm(trimmed);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const setValueAt = (index: number, text: string) => {
    setValues(prev => prev.map((v, i) => (i === index ? text : v)));
  };

  const isBottom = variant === 'bottom';

  return (
    <ModalShell
      visible={visible}
      onClose={onClose}
      variant={variant}
      animationType={isBottom ? 'slide' : 'fade'}
      keyboardAvoid={{kind: 'translate', fraction: isBottom ? 1 : 0.5}}
      keyboardVerticalOffset={isBottom ? 0 : 24}
      panelStyle={isBottom ? styles.panelBottom : styles.panelCenter}
    >
      <Text
        style={[
          isBottom ? styles.title : styles.titleCenter,
          {color: tokens.text},
        ]}
      >
        {title}
      </Text>
      {effectiveFields.map((field, index) => (
        <View key={index}>
          {field.label ? (
            <Text style={[styles.label, {color: tokens.textSecondary}]}>
              {field.label}
            </Text>
          ) : null}
          <TextInput
            testID={index === 0 ? 'text-prompt-input' : undefined}
            style={[
              styles.input,
              {
                color: tokens.text,
                borderColor: tokens.border,
                backgroundColor: tokens.background,
              },
            ]}
            value={values[index] ?? ''}
            onChangeText={text => setValueAt(index, text)}
            placeholder={field.placeholder}
            placeholderTextColor={tokens.textSecondary}
            autoFocus={index === 0}
            autoCorrect={false}
            autoCapitalize={field.autoCapitalize}
            returnKeyType="done"
            onSubmitEditing={() => handleConfirm().catch(() => undefined)}
          />
        </View>
      ))}
      {/* center：input marginBottom 8 + actions marginTop 8 = 16；
          bottom：panel gap 8 兜底段间距，input marginBottom 8 + gap 8 + marginTop 0 = 16
          （还原旧 AddModelModal 的 16，勿再叠加 marginTop）。 */}
      <View style={isBottom ? styles.actionsBottom : styles.actionsCenter}>
        <Pressable onPress={onClose} style={styles.btn}>
          <Text style={{color: tokens.textSecondary}}>取消</Text>
        </Pressable>
        <Pressable
          testID="text-prompt-submit"
          onPress={() => handleConfirm().catch(() => undefined)}
          style={styles.btn}
          disabled={!canSubmit}
        >
          <Text
            style={{
              color: canSubmit ? tokens.primary : tokens.textTertiary,
              fontWeight: '600',
            }}
          >
            {saving ? '保存中…' : confirmLabel}
          </Text>
        </Pressable>
      </View>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  panelCenter: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    padding: 20,
  },
  panelBottom: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    padding: 20,
    paddingBottom: 32,
    gap: 8,
  },
  // center 面板无 gap，标题下间距由 titleCenter 自带 marginBottom 12（旧居中版值）；
  // bottom 靠 panel gap 8 还原旧 marginBottom 8，title 不能再加。
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  titleCenter: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 8,
  },
  actionsCenter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 8,
  },
  actionsBottom: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 0,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
