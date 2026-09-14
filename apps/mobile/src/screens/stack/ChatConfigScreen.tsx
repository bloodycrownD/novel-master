/**
 * 聊天相关偏好：流式输出、思考提示词、富文本消息，以及压缩配置。
 */
import React, {useCallback, useState} from 'react';
import {
  DEFAULT_HIDE_START_DEPTH,
  type CompactionConditions,
} from '@novel-master/core/compaction';
import {useFocusEffect} from '@react-navigation/native';
import {Platform, StyleSheet, Switch} from 'react-native';
import {ProfileSwitchItem} from '../../components/profile/ProfileSwitchItem';
import {ProfileMenuItem} from '../../components/profile/ProfileMenuItem';
import {FormField} from '../../components/form/FormField';
import {FormSectionCard} from '../../components/form/FormSectionCard';
import {FormTextInput} from '../../components/form/FormTextInput';
import {ScreenFormLayout} from '../../components/form/ScreenFormLayout';
import {StickyFormFooter} from '../../components/form/StickyFormFooter';
import {useRuntime} from '../../hooks/useRuntime';
import {useNovelMaster} from '../../runtime/novel-master-context';
import {
  readMessageNotificationEnabled,
  writeMessageNotificationEnabled,
} from '../../storage/message-notification-pref';
import {
  ensureAgentNotificationPermission,
  getAgentNotificationPermissionStatus,
  requestAgentNotificationPermissionManually,
  setKeepAliveResidentEnabled,
} from '../../services/agent-finished-notification';
import {
  readChatRichTextEnabled,
  writeChatRichTextEnabled,
} from '../../storage/chat-rich-text-pref';
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
  const [chatRichTextEnabled, setChatRichTextEnabled] = useState(false);
  const [messageNotificationEnabled, setMessageNotificationEnabled] =
    useState(false);
  // 「通知权限」行三态：checking 兼作首帧占位与手动申请中的防重入标记。
  const [notificationPermission, setNotificationPermission] = useState<
    'authorized' | 'denied' | 'checking'
  >('checking');

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

  const refreshChatRichTextPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setChatRichTextEnabled(await readChatRichTextEnabled(appUi));
  }, [appUi]);

  const refreshMessageNotificationPref = useCallback(async () => {
    if (appUi == null) {
      return;
    }
    setMessageNotificationEnabled(
      await readMessageNotificationEnabled(appUi),
    );
  }, [appUi]);

  const refreshNotificationPermission = useCallback(async () => {
    // 权限行仅 Android 渲染，非 Android 不查询。
    if (Platform.OS !== 'android') {
      return;
    }
    try {
      setNotificationPermission(await getAgentNotificationPermissionStatus());
    } catch {
      // 查询失败按未授权展示：权限行的点击出口始终可用（手动申请路径）。
      setNotificationPermission('denied');
    }
  }, []);

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
      refreshChatRichTextPref().catch(() => undefined);
      refreshMessageNotificationPref().catch(() => undefined);
      refreshNotificationPermission().catch(() => undefined);
      refreshCompaction().catch(() => undefined);
    }, [
      refreshStreamPref,
      refreshThinkingContextPref,
      refreshChatRichTextPref,
      refreshMessageNotificationPref,
      refreshNotificationPermission,
      refreshCompaction,
    ]),
  );

  const handleNotificationPermissionPress = useCallback(() => {
    // 防重入：申请中（checking）不重复发起；已授权（authorized）无需操作。
    if (notificationPermission !== 'denied') {
      return;
    }
    setNotificationPermission('checking');
    // 权限弹窗关闭不触发 navigation focus，回执是状态更新的可靠源。
    requestAgentNotificationPermissionManually()
      .then(setNotificationPermission)
      .catch(() => setNotificationPermission('denied'));
  }, [notificationPermission]);

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

      <ProfileSwitchItem
        icon="🔔"
        label="消息通知"
        subtitle={
          messageNotificationEnabled
            ? '进入应用即常驻状态栏保活，生成中显示状态，结束后台提醒'
            : '无常驻通知、无提醒（生成行为不受影响）'
        }
        value={messageNotificationEnabled}
        tokens={tokens}
        onValueChange={enabled => {
          setMessageNotificationEnabled(enabled);
          if (appUi) {
            void persistSwitchWithRollback(
              async () => {
                await writeMessageNotificationEnabled(appUi, enabled);
                // 存储已持久化，通知模块的进程级副作用失败只 toast 不回滚
                //（不易回滚，下次启动按存储态收敛）。
                setKeepAliveResidentEnabled(enabled).catch(cause => {
                  showToast(toastMessage('常驻保活切换失败', cause));
                });
                if (enabled) {
                  // 关→开：权限申请前移到开关切换（拒绝过一次后不再自动弹）。
                  ensureAgentNotificationPermission().catch(cause => {
                    showToast(toastMessage('通知权限申请失败', cause));
                  });
                }
              },
              () => setMessageNotificationEnabled(!enabled),
            );
          }
        }}
      />

      {Platform.OS === 'android' ? (
        <ProfileMenuItem
          icon="🔔"
          label="通知权限"
          value={
            notificationPermission === 'authorized'
              ? '已授权'
              : notificationPermission === 'denied'
                ? '未授权'
                : '申请中…'
          }
          onPress={handleNotificationPermissionPress}
          tokens={tokens}
        />
      ) : null}

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
