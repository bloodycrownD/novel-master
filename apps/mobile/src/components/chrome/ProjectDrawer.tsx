/**
 * Left-side project drawer (examples/mobile .side-drawer.project-drawer).
 */
import React, {useEffect, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {type ChatProject} from '@novel-master/core/chat';
import {ModalShell} from '../ui/ModalShell';
import {BatchCheckbox} from '../batch/BatchCheckbox';
import {ManageHeader} from '../batch/ManageHeader';
import {BottomSheetMenu} from '../sheet/BottomSheetMenu';
import {PrimaryButton} from '../ui/Buttons';
import {TextPromptModal} from '../ui/TextPromptModal';
import {useBatchSelection} from '../../hooks/useBatchSelection';
import {FormatRelativeTime} from '../../utils/format-relative-time';
import {useTheme} from '../../theme/ThemeProvider';
import {useToast} from '../chrome/ToastHost';
import {ToastMessage} from '../../errors/toast-message';
import {coreT} from '../../i18n/core';
import {EntityIcon} from '../../utils/entity-icon';

const PROJECT_ICONS = ['📁', '📚', '✨', '🚀', '📝', '🎯'];

type NamePromptState = {mode: 'create'} | {mode: 'rename'; projectId: string; initialName: string};

type Props = {
    visible: boolean;
    projects: ChatProject[];
    currentProjectId: string | undefined;
    onClose: () => void;
    onSelect: (projectId: string) => void;
    onCreateProject: (name: string) => void | Promise<void>;
    onRenameProject: (projectId: string, name: string) => void | Promise<void>;
    onDeleteSelected: (projectIds: string[]) => void | Promise<void>;
};

export function ProjectDrawer({visible, projects, currentProjectId, onClose, onSelect, onCreateProject, onRenameProject, onDeleteSelected}: Props) {
    const {tokens} = useTheme();
    const {showToast} = useToast();
    const insets = useSafeAreaInsets();
    const batch = useBatchSelection();
    const [namePrompt, setNamePrompt] = useState<NamePromptState | null>(null);
    const [menuProjectId, setMenuProjectId] = useState<string | undefined>();

    useEffect(() => {
        if (!visible) {
            batch.exit();
            setNamePrompt(null);
            setMenuProjectId(undefined);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when drawer closes
    }, [visible]);

    const menuProject = projects.find(p => p.id === menuProjectId);

    const confirmBatchDelete = () => {
        const ids = Array.from(batch.selectedIds);
        if (ids.length === 0) {
            return;
        }
        Alert.alert(coreT({key: "ui.common.confirm_delete"}), coreT({key: "ui.project.delete_batch_confirm", params: {count: ids.length}}), [
            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
            {
                text: coreT({key: "ui.common.delete"}),
                style: 'destructive',
                onPress: () => {
                    void Promise.resolve(onDeleteSelected(ids)).then(() => {
                        batch.exit();
                    });
                },
            },
        ]);
    };

    return (
        <>
            <ModalShell
                visible={visible}
                onClose={onClose}
                variant="left"
                animationType="fade"
                panelStyle={[
                    styles.drawer,
                    {
                        paddingTop: insets.top,
                        paddingBottom: Math.max(insets.bottom, 12),
                    },
                ]}
            >
                <ManageHeader
                    title={coreT({key: "ui.project.title"})}
                    batchMode={batch.active}
                    selectedCount={batch.selectedCount}
                    onEnterBatch={batch.enter}
                    onCancelBatch={batch.exit}
                    onDelete={confirmBatchDelete}
                    hint={coreT({key: "ui.project.delete_select_hint"})}
                    normalActions={<PrimaryButton label={coreT({key: "ui.common.new"})} tokens={tokens} onPress={() => setNamePrompt({mode: 'create'})} />}
                />
                <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
                    {projects.length === 0 ? (
                        <Text style={[styles.empty, {color: tokens.textSecondary}]}>{coreT({key: "ui.project.empty_mobile"})}</Text>
                    ) : (
                        projects.map((project, index) => {
                            const isCurrent = project.id === currentProjectId;
                            const selected = batch.isSelected(project.id);
                            return (
                                <Pressable
                                    key={project.id}
                                    style={[
                                        styles.projectCard,
                                        {
                                            backgroundColor: tokens.surfaceElevated,
                                            borderColor: selected ? tokens.primary : tokens.borderLight,
                                            borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
                                        },
                                    ]}
                                    onPress={() => {
                                        if (batch.active) {
                                            batch.toggle(project.id);
                                        } else {
                                            onSelect(project.id);
                                            onClose();
                                        }
                                    }}
                                >
                                    {batch.active ? <BatchCheckbox checked={selected} onToggle={() => batch.toggle(project.id)} /> : <Text style={styles.projectIcon}>{EntityIcon.pick(project.id, PROJECT_ICONS)}</Text>}
                                    <View style={styles.projectInfo}>
                                        <Text style={[styles.projectName, {color: tokens.text}]} numberOfLines={1}>
                                            {project.name}
                                        </Text>
                                        <Text style={[styles.projectMeta, {color: tokens.textSecondary}]}>{coreT({key: "ui.common.updated_at", params: {time: FormatRelativeTime.formatMs(project.updatedAtMs)}})}</Text>
                                    </View>
                                    {isCurrent && !batch.active ? (
                                        <View style={[styles.currentBadge, {backgroundColor: tokens.primary}]}>
                                            <Text style={styles.currentBadgeText}>{coreT({key: "ui.common.current"})}</Text>
                                        </View>
                                    ) : null}
                                    {!batch.active ? (
                                        <>
                                            <Pressable
                                                hitSlop={8}
                                                testID={`project-menu-${project.id}`}
                                                onPress={e => {
                                                    e.stopPropagation?.();
                                                    setMenuProjectId(project.id);
                                                }}
                                            >
                                                <Text style={[styles.menuDots, {color: tokens.textSecondary}]}>⋮</Text>
                                            </Pressable>
                                            <Text style={[styles.chevron, {color: tokens.textTertiary}]}>›</Text>
                                        </>
                                    ) : null}
                                </Pressable>
                            );
                        })
                    )}
                </ScrollView>
            </ModalShell>

            <BottomSheetMenu
                visible={menuProjectId != null}
                items={[
                    {label: coreT({key: "ui.common.rename"}), action: 'rename'},
                    {label: coreT({key: "ui.common.delete"}), action: 'delete', danger: true},
                ]}
                onClose={() => setMenuProjectId(undefined)}
                onSelect={action => {
                    const project = menuProject;
                    setMenuProjectId(undefined);
                    if (action === 'rename' && project) {
                        setNamePrompt({
                            mode: 'rename',
                            projectId: project.id,
                            initialName: project.name,
                        });
                        return;
                    }
                    if (action === 'delete' && project) {
                        Alert.alert(coreT({key: "ui.common.confirm_delete"}), coreT({key: "ui.project.delete_confirm_named", params: {name: project.name}}), [
                            {text: coreT({key: "ui.common.cancel"}), style: 'cancel'},
                            {
                                text: coreT({key: "ui.common.delete"}),
                                style: 'destructive',
                                onPress: () => {
                                    void Promise.resolve(onDeleteSelected([project.id])).catch(err => showToast(ToastMessage.toast(coreT({key: "ui.common.delete_failed"}), err)));
                                },
                            },
                        ]);
                    }
                }}
            />

            <TextPromptModal
                visible={namePrompt != null}
                title={namePrompt?.mode === 'rename' ? coreT({key: "ui.project.rename_title"}) : coreT({key: "ui.project.new_title"})}
                label={coreT({key: "ui.project.name_label"})}
                placeholder={coreT({key: "ui.project.name_placeholder"})}
                initialValue={namePrompt?.mode === 'rename' ? namePrompt.initialName : ''}
                confirmLabel={namePrompt?.mode === 'rename' ? coreT({key: "ui.common.save"}) : coreT({key: "ui.common.create"})}
                onClose={() => setNamePrompt(null)}
                onConfirm={async values => {
                    const name = values[0];
                    if (namePrompt?.mode === 'create') {
                        await onCreateProject(name);
                    } else if (namePrompt?.mode === 'rename') {
                        await onRenameProject(namePrompt.projectId, name);
                    }
                }}
            />
        </>
    );
}

const styles = StyleSheet.create({
    drawer: {
        width: '88%',
        maxWidth: 320,
        shadowColor: '#000',
        shadowOffset: {width: 4, height: 0},
        shadowOpacity: 0.2,
        shadowRadius: 24,
        elevation: 16,
    },
    backdrop: {
        flex: 1,
    },
    list: {
        flex: 1,
    },
    listContent: {
        paddingTop: 12,
        paddingBottom: 16,
    },
    empty: {
        textAlign: 'center',
        marginTop: 32,
        fontSize: 14,
        lineHeight: 20,
    },
    projectCard: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 5,
        marginBottom: 12,
        padding: 16,
        borderRadius: 16,
        gap: 8,
    },
    projectIcon: {
        fontSize: 28,
        width: 36,
        textAlign: 'center',
    },
    projectInfo: {
        flex: 1,
        minWidth: 0,
    },
    projectName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    projectMeta: {
        fontSize: 13,
    },
    currentBadge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        marginRight: 4,
    },
    currentBadgeText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
    menuDots: {
        fontSize: 18,
        paddingHorizontal: 4,
    },
    chevron: {
        fontSize: 22,
        fontWeight: '300',
    },
});
