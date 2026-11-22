/**
 * Agent 选择器：同时服务「我的」tab（workspace 全局）与会话详情页（session 绑定）。
 *
 * 传入 `sessionId` 时走会话级路径——读 `loadSessionAgentPickerRows`，
 * 写 `selectSessionAgent`（不动 workspace 全局指针）；不传时维持原 workspace 行为。
 * 骨架（加载/错误重试/空态/列表）由 PickerListModal 承担。
 */
import React, {useCallback} from 'react';
import {Text} from 'react-native';
import type {Result} from '@novel-master/core/errors';
import {AppError} from '@novel-master/core/errors';
import {useRuntime} from '../../hooks/useRuntime';
import {ToastMessage} from '../../errors/toast-message';
import {coreT} from '../../i18n/core';
import {useToast} from '../chrome/ToastHost';
import {useTheme} from '../../theme/ThemeProvider';
import {
    PickerListModal,
    type PickerListLoadResult,
} from '../ui/PickerListModal';
import {AGENT_PICKER_EMPTY_MESSAGE, AgentPicker, type AgentPickerRow} from '../../services/agent-picker';

type Props = {
    visible: boolean;
    onClose: () => void;
    onSelected?: (agentId: string) => void;
    /**
   * 传入后会话级分流：读 session 绑定作为当前选中，写 selectSessionAgent。
   * 不传则维持 workspace 全局行为（「我的」tab）。
   */
    sessionId?: string;
};

export function AgentPickerModal({
    visible,
    onClose,
    onSelected,
    sessionId,
}: Props) {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const runtime = useRuntime();

    const load = useCallback(async (): Promise<
        Result<PickerListLoadResult<AgentPickerRow>, AppError>
    > => {
        // 有 sessionId 走会话级（绑定优先、缺失回退 workspace）；否则读 workspace 全局。
        return sessionId != null
            ? AgentPicker.loadSessionRows(runtime, sessionId)
            : AgentPicker.loadRows(runtime);
    }, [runtime, sessionId]);

    const select = useCallback(
        async (agentId: string) => {
            // 分流：session 绑定只影响单个会话；workspace 入口继续写全局指针。
            // 写入成功才回调并关闭；失败留在弹窗里 toast 提示，方便重试。
            try {
                if (sessionId != null) {
                    await AgentPicker.selectSession(runtime, sessionId, agentId);
                } else {
                    await AgentPicker.selectWorkspace(runtime, agentId);
                }
            } catch (cause) {
                showToast(ToastMessage.toast(coreT({key: "ui.common.set_failed"}), cause));
                return;
            }
            onSelected?.(agentId);
            onClose();
        },
        [runtime, sessionId, onSelected, onClose, showToast],
    );

    return (
        <PickerListModal<AgentPickerRow>
            visible={visible}
            title={coreT({key: "ui.session.agent_picker_title"})}
            load={load}
            keyExtractor={item => item.agentId}
            isSelected={(item, index, selectedId) =>
                AgentPicker.isRowSelected(item.agentId, index, selectedId)
            }
            renderRow={(item, selected) => (
                <>
                    <Text style={{color: tokens.text, flex: 1}}>{item.label}</Text>
                    {selected ? <Text style={{color: tokens.primary}}>{coreT({key: "ui.common.current"})}</Text> : null}
                </>
            )}
            onPick={item => select(item.agentId)}
            emptyText={AGENT_PICKER_EMPTY_MESSAGE}
            onClose={onClose}
        />
    );
}
