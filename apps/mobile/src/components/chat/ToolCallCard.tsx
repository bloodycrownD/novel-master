/**
 * Tool invocation card with status from paired tool_result.
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {coreT} from '@/i18n/core';
import {useTheme} from '@/theme/ThemeProvider';
import {MessageBlocks, ToolSummary, type ToolCallView} from './message-blocks';
import type {SkillToolRef} from '@novel-master/core/chat';

type Props = {
    tool: ToolCallView;
    showFullParams?: boolean;
    /** Inline row inside ToolCallGroupCard (no outer list margins). */
    groupItem?: boolean;
    /** When set and tool has a VFS file path, the card is tappable. */
    onOpenFile?: (path: string) => void;
    /** 当 tool 带 subagentSessionId 时，点击跳转子会话只读浏览。 */
    onOpenSubagentSession?: (sessionId: string) => void;
    /** skill 卡片点击跳技能详情（project 域缺 projectId 时由调用方补会话项目）。 */
    onOpenSkillDetail?: (ref: SkillToolRef) => void;
};

/** 状态 → 文案与主题色键（单表驱动，卡片头部与配色同源）。 */
const STATUS_META: Record<ToolCallView['status'], {label: string; tone: 'primary' | 'danger' | 'textSecondary'}> = {
    success: {label: coreT({key: "ui.transcript.tool_status.success"}), tone: 'primary'},
    error: {label: coreT({key: "ui.transcript.tool_status.error"}), tone: 'danger'},
    pending: {label: coreT({key: "ui.transcript.tool_status.pending"}), tone: 'textSecondary'},
    interrupted: {label: coreT({key: "ui.transcript.tool_status.interrupted"}), tone: 'textSecondary'},
};

export function ToolCallCard({tool, showFullParams, groupItem = false, onOpenFile, onOpenSubagentSession, onOpenSkillDetail}: Props) {
    const {tokens} = useTheme();
    const filePath = MessageBlocks.vfsToolFilePath(tool);
    const subagentSessionId = tool.subagentSessionId;
    // skill 跳转三元组：meta 透传优先，否则从 input 解析（write/edit）。
    // projectId 由最终导航方按会话上下文补齐，这里不传。
    const skillRef = onOpenSkillDetail != null ? MessageBlocks.skillToolRef(tool) : undefined;
    // canOpen 对称 vfs 文件路径：任一可跳转目标存在即视为可点。
    const canOpenFile = filePath != null && onOpenFile != null;
    // prettier-ignore
    const canOpenSubagent = subagentSessionId != null && onOpenSubagentSession != null;
    const canOpenSkill = skillRef != null && onOpenSkillDetail != null;
    const canOpen = canOpenFile || canOpenSubagent || canOpenSkill;
    // prettier-ignore
    const detail = showFullParams ? JSON.stringify(tool.input, null, 2) : ToolSummary.callSummary(tool);
    const statusMeta = STATUS_META[tool.status];
    // prettier-ignore
    let openHint: string;
    if (canOpenSubagent) {
        openHint = coreT({key: "ui.transcript.open_hint", params: {kind: coreT({key: "ui.transcript.open_kind.subagent"})}});
    } else if (canOpenSkill) {
        openHint = coreT({key: "ui.transcript.open_hint", params: {kind: coreT({key: "ui.transcript.open_kind.skill"})}});
    } else {
        openHint = coreT({key: "ui.transcript.open_hint", params: {kind: coreT({key: "ui.transcript.open_kind.workspace"})}});
    }

    // aria 标签按优先级说清打开目标：子会话 > 技能 > 文件
    let openAriaLabel: string;
    if (canOpenSubagent) {
        openAriaLabel = coreT({key: "ui.chat.open_subagent_aria", params: {id: subagentSessionId}});
    } else if (canOpenSkill) {
        openAriaLabel = coreT({key: "ui.chat.open_skill_aria", params: {name: skillRef.name}});
    } else {
        openAriaLabel = coreT({key: "ui.chat.open_file_aria", params: {path: filePath}});
    }

    const card = (
        <>
            <View style={styles.header}>
                <Text style={[styles.name, {color: tokens.text}]} numberOfLines={1}>
                    {tool.name}
                </Text>
                <Text style={[styles.status, {color: tokens[statusMeta.tone]}]}>{statusMeta.label}</Text>
            </View>
            {detail ? (
                <Text style={[styles.summary, {color: tokens.textSecondary}]} numberOfLines={3}>
                    {detail}
                </Text>
            ) : null}
            {canOpen ? <Text style={[styles.openHint, {color: tokens.primary}]}>{openHint}</Text> : null}
        </>
    );

    if (canOpen) {
        return (
            <Pressable
                accessibilityRole="button"
                // prettier-ignore
                accessibilityLabel={openAriaLabel}
                onPress={() => {
                    if (canOpenSubagent) {
                        onOpenSubagentSession(subagentSessionId);
                    } else if (canOpenSkill) {
                        onOpenSkillDetail(skillRef);
                    } else if (canOpenFile) {
                        onOpenFile(filePath);
                    }
                }}
                style={({pressed}) => [
                    groupItem ? styles.groupItem : styles.card,
                    {
                        backgroundColor: tokens.surface,
                        borderColor: tokens.primary,
                        opacity: pressed ? 0.85 : 1,
                    },
                ]}
            >
                {card}
            </Pressable>
        );
    }

    return <View style={[groupItem ? styles.groupItem : styles.card, {backgroundColor: tokens.surface, borderColor: tokens.border}]}>{card}</View>;
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 12,
        marginVertical: 6,
        padding: 12,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
    },
    groupItem: {
        alignSelf: 'stretch',
        width: '100%',
        padding: 10,
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
    },
    name: {flex: 1, fontWeight: '600', fontSize: 14},
    status: {fontSize: 12, fontWeight: '500'},
    summary: {marginTop: 6, fontSize: 13},
    openHint: {marginTop: 8, fontSize: 12, fontWeight: '500'},
});
