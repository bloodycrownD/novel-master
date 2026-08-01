/**
 * 聊天相关偏好：流式输出、版本校验、富文本消息。
 */
import React, {useCallback, useState} from 'react';
import {ScrollView, StyleSheet} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {ProfileSwitchItem} from '../../components/ui/ProfileSwitchItem';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  readChatRichTextEnabled,
  writeChatRichTextEnabled,
} from '../../storage/chat-rich-text-pref';
import {
  SESSION_FS_LABELS,
  USER_OPS_LABELS,
} from '@novel-master/core/config-forms/shared';
import {useTheme} from '../../theme/ThemeProvider';

export function ChatConfigScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const {appUi} = useNovelMaster();
  const [llmStreamEnabled, setLlmStreamEnabled] = useState(true);
  const [sessionFsVersionCheck, setSessionFsVersionCheck] = useState(true);
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
  const [userOpsLogEnabled, setUserOpsLogEnabled] = useState(true);

  const refreshStreamPref = useCallback(async () => {
    setLlmStreamEnabled(await runtime.preferences.getLlmStreamEnabled());
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

  const refreshUserOpsLogPref = useCallback(async () => {
    setUserOpsLogEnabled(await runtime.preferences.getUserOpsLogEnabled());
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      refreshStreamPref().catch(() => undefined);
      refreshSessionFsVersionCheckPref().catch(() => undefined);
      refreshChatRichTextPref().catch(() => undefined);
      refreshUserOpsLogPref().catch(() => undefined);
    }, [
      refreshStreamPref,
      refreshSessionFsVersionCheckPref,
      refreshChatRichTextPref,
      refreshUserOpsLogPref,
    ]),
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled">
      <ProfileSwitchItem
        icon="⚡"
        label="流式输出"
        subtitle={
          llmStreamEnabled
            ? '边生成边显示（推荐）'
            : '完成后一次性显示回复'
        }
        value={llmStreamEnabled}
        tokens={tokens}
        onValueChange={enabled => {
          setLlmStreamEnabled(enabled);
          runtime.preferences
            .setLlmStreamEnabled(enabled)
            .catch(() => undefined);
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
          runtime.preferences
            .setSessionFsVersionCheck(enabled)
            .catch(() => undefined);
        }}
      />
      <ProfileSwitchItem
        icon="🕹️"
        label={USER_OPS_LABELS.title}
        subtitle={
          userOpsLogEnabled
            ? USER_OPS_LABELS.enabledHint
            : USER_OPS_LABELS.disabledHint
        }
        value={userOpsLogEnabled}
        tokens={tokens}
        onValueChange={enabled => {
          setUserOpsLogEnabled(enabled);
          runtime.preferences
            .setUserOpsLogEnabled(enabled)
            .catch(() => undefined);
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
            writeChatRichTextEnabled(appUi, enabled).catch(() => undefined);
          }
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1},
  scrollContent: {paddingTop: 8, paddingBottom: 24},
});
