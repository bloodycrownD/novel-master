/**
 * 聊天相关偏好：流式输出、思考提示词、版本校验、富文本消息，以及压缩配置。
 */
import React, {useCallback, useState} from 'react';
import {
  DEFAULT_HIDE_START_DEPTH,
  type CompactionConditions,
} from '@novel-master/core/compaction';
import {useFocusEffect} from '@react-navigation/native';
import {StyleSheet, Switch} from 'react-native';
import {ProfileSwitchItem} from '../../components/profile/ProfileSwitchItem';
import {FormField} from '../../components/form/FormField';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormTextInput} from '../../components/form/FormTextInput';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  readChatRichTextEnabled,
  writeChatRichTextEnabled,
} from '../../storage/chat-rich-text-pref';
import {SESSION_FS_LABELS} from '@novel-master/core/config-forms/shared';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../../components/chrome/ToastHost';
import {toastMessage} from '../../errors/toast-message';

const DEFAULT_CONDITIONS: CompactionConditions = {
  schemaVersion: 4,
  enabled: false,
  tokenRatio: 0.8,
  hideStartDepth: DEFAULT_HIDE_START_DEPTH,
};

export function ChatConfigScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const [llmStreamEnabled, setLlmStreamEnabled] = useState(true);
  const [thinkingContextEnabled, setThinkingContextEnabled] = useState(true);
  const [sessionFsVersionCheck, setSessionFsVersionCheck] = useState(true);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);

  const [compactionEnabled, setCompactionEnabled] = useState(false);
  const [compactionTokenRatio, setCompactionTokenRatio] = useState('0.8');
  const [compactionHideStartDepth, setCompactionHideStartDepth] = useState(
    String(DEFAULT_HIDE_START_DEPTH),
  );
  const [compactionSaving, setCompactionSaving] = useState(false);

  const refreshStreamPref = useCallback(async () => {
    setLlmStreamEnabled(await runtime.preferences.getLlmStreamEnabled());
  }, [runtime]);

  const refreshThinkingContextPref = useCallback(async () => {
    setThinkingContextEnabled(
      await runtime.preferences.getThinkingContextEnabled(),
    );
  }, [runtime]);

  const refreshSessionFsVersionCheckPref = useCallback(async () => {
    setSessionFsVersionCheck(
      await runtime.preferences.getSessionFsVersionCheck(),
    );
  }, [runtime]);

  const refreshChatRichTextPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setChatRichTextEnabled(await readChatRichTextEnabled(appUi));
  }, [appUi]);

  const refreshCompaction = useCallback(async () => {
    const stored = await runtime.compactionConditions.getConditions();
    const c = stored ?? DEFAULT_CONDITIONS;
    setCompactionEnabled(c.enabled);
    setCompactionTokenRatio(c.tokenRatio != null ? String(c.tokenRatio) : '');
    setCompactionHideStartDepth(
      c.hideStartDepth != null
        ? String(c.hideStartDepth)
        : String(DEFAULT_HIDE_START_DEPTH),
    );
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      refreshStreamPref().catch(() => undefined);
      refreshThinkingContextPref().catch(() => undefined);
      refreshSessionFsVersionCheckPref().catch(() => undefined);
      refreshChatRichTextPref().catch(() => undefined);
      refreshCompaction().catch(() => undefined);
    }, [
      refreshStreamPref,
      refreshThinkingContextPref,
      refreshSessionFsVersionCheckPref,
      refreshChatRichTextPref,
      refreshCompaction,
    ]),
  );

  // 四个偏好开关采用「乐观更新 + 失败回滚」：先立即翻转开关保证跟手，
  // 持久化 reject 时回滚到原值并 toast（未选「成功才翻转」——那会让开关
  // 在异步写入期间显得无响应）。回调里依次传写入动作与回滚动作。
  const persistSwitchWithRollback = useCallback(
    async (persist: () => Promise<void>, rollback: () => void) => {
      try {
        await persist();
      } catch (cause) {
        rollback();
        showToast(toastMessage('保存失败', cause));
      }
    },
    [showToast],
  );

  const collectCompaction = (): CompactionConditions | null => {
    const ratio = compactionTokenRatio.trim()
      ? Number(compactionTokenRatio)
      : undefined;
    const hide = compactionHideStartDepth.trim()
      ? Number(compactionHideStartDepth)
      : undefined;
    if (compactionEnabled && ratio == null) {
      showToast('启用时至少填写 token 比例');
      return null;
    }
    return {
      schemaVersion: 4,
      enabled: compactionEnabled,
      ...(ratio != null ? {tokenRatio: ratio} : {}),
      ...(hide != null ? {hideStartDepth: hide} : {}),
    };
  };

  const handleSaveCompaction = async () => {
    const conditions = collectCompaction();
    if (!conditions) {
      return;
    }
    setCompactionSaving(true);
    try {
      await runtime.compactionConditions.setConditions(conditions);
      showToast('已保存压缩配置');
    } catch (error) {
      showToast(toastMessage('保存失败', error));
    } finally {
      setCompactionSaving(false);
    }
  };

  return (
    <ScreenFormLayout
      tokens={tokens}
      footer={
        <StickyFormFooter
          tokens={tokens}
          label="保存"
          loading={compactionSaving}
          onPress={() => handleSaveCompaction().catch(() => undefined)}
        />
      }
    >
      <ProfileSwitchItem
        icon="⚡"
        label="流式输出"
        subtitle={
          llmStreamEnabled ? '边生成边显示（推荐）' : '完成后一次性显示回复'
        }
        value={llmStreamEnabled}
        tokens={tokens}
        onValueChange={enabled => {
          setLlmStreamEnabled(enabled);
          void persistSwitchWithRollback(
            () => runtime.preferences.setLlmStreamEnabled(enabled),
            () => setLlmStreamEnabled(!enabled),
          );
        }}
      />
      <ProfileSwitchItem
        icon="🧠"
        label="思考提示词"
        subtitle="开启后，模型的思考内容进入后续提示词，关闭则不进入。"
        value={thinkingContextEnabled}
        tokens={tokens}
        onValueChange={enabled => {
          setThinkingContextEnabled(enabled);
          void persistSwitchWithRollback(
            () => runtime.preferences.setThinkingContextEnabled(enabled),
            () => setThinkingContextEnabled(!enabled),
          );
        }}
      />
      <ProfileSwitchItem
        icon="🛡️"
        label={SESSION_FS_LABELS.title}
        subtitle={
          sessionFsVersionCheck
            ? SESSION_FS_LABELS.enabledHint
            : SESSION_FS_LABELS.disabledHint
        }
        value={sessionFsVersionCheck}
        tokens={tokens}
        onValueChange={enabled => {
          setSessionFsVersionCheck(enabled);
          void persistSwitchWithRollback(
            () => runtime.preferences.setSessionFsVersionCheck(enabled),
            () => setSessionFsVersionCheck(!enabled),
          );
        }}
      />
      <ProfileSwitchItem
        icon="📝"
        label="富文本消息"
        subtitle={
          chatRichTextEnabled
            ? '用户与助手消息解析 Markdown/HTML'
            : '聊天消息显示为纯文本'
        }
        value={chatRichTextEnabled}
        tokens={tokens}
        onValueChange={enabled => {
          setChatRichTextEnabled(enabled);
          if (appUi) {
            void persistSwitchWithRollback(
              () => writeChatRichTextEnabled(appUi, enabled),
              () => setChatRichTextEnabled(!enabled),
            );
          }
        }}
      />

      <FormSectionCard
        title="压缩配置"
        tokens={tokens}
        hint="满足 token 比例阈值时自动压缩；隐藏起始深度对自动和手动压缩均生效。"
      >
        <FormField label="隐藏起始深度" tokens={tokens} row>
          <FormTextInput
            tokens={tokens}
            value={compactionHideStartDepth}
            onChangeText={setCompactionHideStartDepth}
            keyboardType="number-pad"
            placeholder="6"
            style={styles.compactionInput}
          />
        </FormField>
        <FormField label="启用自动压缩" tokens={tokens} row>
          <Switch
            value={compactionEnabled}
            onValueChange={setCompactionEnabled}
            trackColor={{false: tokens.border, true: tokens.primary}}
          />
        </FormField>
        {compactionEnabled ? (
          <FormField label="Token 比例" tokens={tokens} row>
            <FormTextInput
              tokens={tokens}
              value={compactionTokenRatio}
              onChangeText={setCompactionTokenRatio}
              keyboardType="decimal-pad"
              placeholder="0.8"
              style={styles.compactionInput}
            />
          </FormField>
        ) : null}
      </FormSectionCard>
    </ScreenFormLayout>
  );
}

const styles = StyleSheet.create({
  // row 模式下给输入框限宽，避免撑满整行把标签挤没。数字 / 小数输入 100 够用。
  compactionInput: {width: 100, textAlign: 'center'},
});
