/**
 * Composer 状态 chip（不可叉）：workplace + user_ops（含 annotate 预览）。
 * 文件引用不再使用 attach chip（认正文 `@路径`）；userAttach 不进状态条。
 * 判定 / partition 单点：`@novel-master/core/chat`。
 */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {AttachmentChip} from '@novel-master/core/chat';
import {composerChips, type MessageAttachment} from '@novel-master/core/chat';
import {coreT} from '@/i18n/core';
import {useTheme} from '@/theme/ThemeProvider';

type AttachmentDraftChipsProps = {
    attachments: readonly MessageAttachment[];
    disabled?: boolean;
    accessibilityLabel?: string;
    /** 行容器透明。 */
    transparentRow?: boolean;
};

// 偏离登记：文件名 AttachmentDraftChips 与组件同名，tsx helper namespace 不得撞组件名；
// helper 主体是 chip 状态文案，按内容主体起名 AttachmentChipLabel，成员剥主体词剩动词。
export namespace AttachmentChipLabel {
    /**
   * Chip 明文（core descriptor 经 coreT 渲染；文案在 chat catalog，zh 逐字同旧口径）。
   */
    // nm-style: keep-public — chip 文案契约：core AttachmentChip.fromAttachment 的命名收口
    export function format(a: MessageAttachment): string {
        const d = AttachmentChip.fromAttachment(a);
        return d == null ? '' : coreT(d);
    }
}

function AttachmentDraftChips({attachments, disabled, accessibilityLabel, transparentRow = false}: AttachmentDraftChipsProps) {
    const {tokens} = useTheme();
    if (attachments.length === 0) {
        return null;
    }
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.row, transparentRow ? styles.rowTransparent : null]}
            contentContainerStyle={styles.content}
            accessibilityLabel={accessibilityLabel}
        >
            {attachments.map((a, index) => {
                const label = AttachmentChipLabel.format(a);
                return (
                    <View
                        key={`${a.source}:${a.path ?? a.name}:${index}`}
                        style={[
                            styles.chip,
                            {
                                backgroundColor: tokens.surface,
                                borderColor: tokens.border,
                            },
                        ]}
                    >
                        <Text style={[styles.label, {color: tokens.text}]} numberOfLines={1}>
                            {label}
                        </Text>
                    </View>
                );
            })}
        </ScrollView>
    );
}

/** 状态 chip（无叉）：放在输入框内顶部。 */
export function ComposerStatusChips({attachments, disabled}: {attachments: readonly MessageAttachment[]; disabled?: boolean}) {
    const {status} = composerChips.partition(attachments);
    return <AttachmentDraftChips attachments={status} disabled={disabled} transparentRow accessibilityLabel={coreT({key: "ui.chat.attachment_status_aria"})} />;
}

const styles = StyleSheet.create({
    row: {maxHeight: 36, marginBottom: 6},
    rowTransparent: {
        backgroundColor: 'transparent',
        marginBottom: 4,
    },
    content: {gap: 6, paddingRight: 8, alignItems: 'center'},
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        maxWidth: 200,
        paddingVertical: 6,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
    },
    label: {fontSize: 12, flexShrink: 1, maxWidth: 160},
});

/**
 * 样式表对外只读出口（web 侧样式相等断言的真源入口）。
 *
 * chips 段 CSS（`src/web/chat-conversation/styles/chat-conversation.css` 的
 * `.chips__row` / `.chip` / `.chip__label`）的数值全部来自本表；断言从 web 侧的
 * `dock-style-reference.ts` 转出这里取，避免在测试里手抄一份常量——手抄的那份一旦
 * 与组件分叉，样式相等断言就退化成「CSS vs 硬编码」，恒真且永不报警。
 */
export const attachmentDraftChipsStyles = styles;
