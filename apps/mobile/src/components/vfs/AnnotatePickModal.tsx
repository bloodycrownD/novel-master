/**
 * 同文多条批注时先选一条再打开详情。
 */
import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import type {AnnotateDraft} from '@novel-master/core/chat';
import {useTheme} from '@/theme/ThemeProvider';
import {coreT} from '@/i18n/core';
import {ModalShell} from '@/components/ui/ModalShell';

type Props = {
    readonly visible: boolean;
    readonly drafts: readonly AnnotateDraft[];
    readonly onPick: (draft: AnnotateDraft) => void;
    readonly onClose: () => void;
};

export function AnnotatePickModal({visible, drafts, onPick, onClose}: Props) {
    const {tokens} = useTheme();

    return (
        <ModalShell
            visible={visible}
            onClose={onClose}
            variant="center"
            animationType="fade"
            backdropOpacity={0.45}
            containerStyle={styles.overlay}
            panelStyle={styles.card}
        >
            <Text style={[styles.title, {color: tokens.text}]}>{coreT({key: "ui.vfs.annotate_pick_title"})}</Text>
            <View style={styles.list}>
                {drafts.map(d => (
                    <Pressable
                        key={d.id}
                        style={[styles.item, {borderBottomColor: tokens.borderLight}]}
                        onPress={() => onPick(d)}
                        accessibilityRole="button"
                        accessibilityLabel={d.userAnnotation || coreT({key: "ui.vfs.annotate_empty_aria"})}
                    >
                        <Text style={[styles.itemText, {color: tokens.text}]}>
                            {d.userAnnotation || coreT({key: "ui.common.empty_note"})}
                        </Text>
                    </Pressable>
                ))}
            </View>
            <Pressable
                style={styles.cancel}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel={coreT({key: "ui.common.cancel"})}
            >
                <Text style={{color: tokens.textSecondary}}>{coreT({key: "ui.common.cancel"})}</Text>
            </Pressable>
        </ModalShell>
    );
}

const styles = StyleSheet.create({
    overlay: {
        paddingHorizontal: 28,
    },
    card: {
        width: '100%',
        borderRadius: 12,
        paddingTop: 16,
        paddingBottom: 8,
        maxHeight: '70%',
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 8,
        paddingHorizontal: 16,
    },
    list: {
        paddingHorizontal: 4,
    },
    item: {
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    itemText: {
        fontSize: 15,
        lineHeight: 22,
    },
    cancel: {
        alignItems: 'center',
        paddingVertical: 14,
    },
});
