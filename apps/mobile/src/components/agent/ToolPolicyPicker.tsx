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
import React, {useCallback, useEffect, useId, useMemo, useRef, useState} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {AgentToolCatalog, type AgentToolCatalogMcpTool} from '@/config-forms/agent';
import {coreT} from '@/i18n/core';
import {FormTextInput} from '../form/FormTextInput';
import {useFormOverlay} from '../form/FormOverlayHost';
import {ModalShell} from '../ui/ModalShell';
import type {ThemeTokens} from '../../theme/tokens';

type Props = {
    tokens: ThemeTokens;
    selected: readonly string[];
    onChange: (selected: string[]) => void;
    /** 页面打开时刻的 MCP 工具快照；缺省 = 未配置，mcp 分组只显示提示占位（不参与勾选与计数）。 */
    mcpTools?: readonly AgentToolCatalogMcpTool[];
    /** 禁用态（只读详情）：trigger 禁点并灰显，不弹 sheet。 */
    disabled?: boolean;
};

export function ToolPolicyPicker({tokens, selected, onChange, mcpTools, disabled = false}: Props) {
    const overlay = useFormOverlay();
    const overlayKey = useId();
    const insets = useSafeAreaInsets();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<readonly string[]>(selected);
    const [query, setQuery] = useState('');

    // draft 仅在 sheet 从关闭翻到打开的那一刻用 selected 初始化一次；
    // 打开期间 selected 即便变了也不重置（避免外部改动把用户正在勾的草稿冲掉）。
    const prevOpenRef = useRef(false);
    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    useEffect(() => {
        if (open && !prevOpenRef.current) {
            setDraft(selected);
            setQuery('');
        }
        prevOpenRef.current = open;
    }, [open, selected]);

    const draftSet = useMemo(() => new Set(draft), [draft]);

    // 页面打开时刻的 catalog 快照：mcp 分组由注入的 prop 同步组装（spec §九，不接 Promise）
    const entries = useMemo(() => AgentToolCatalog.get({mcpTools: () => mcpTools ?? []}).flatMap(group => group.entries), [mcpTools]);
    const total = entries.filter(entry => !entry.placeholder).length;

    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q === '') {
            return entries;
        }
        return entries.filter(item => item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));
    }, [entries, query]);

    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
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

    // nm-style: keep-local — React hook：多行回调 + deps 无法单行（prettier@80 必折行）
    const confirm = useCallback(() => {
        onChange([...draft]);
        close();
    }, [onChange, draft, close]);

    // 键盘避让（上移 + maxHeight 收缩）由 ModalShell standalone + adaptive 策略统一处理：
    // FormOverlayHost 是普通 View 渲染层无任何避让，iOS 也要 iosTranslateY
    // 让面板自己 translateY，否则面板底部被键盘盖住 kb 高度、顶部留 kb 空隙。

    // nm-style: keep-local — sheet 生命周期与 overlay 句柄绑定，内联回 useEffect 会让调用参数跨行
    const showSheet = () => {
        if (!open || !overlay) {
            overlay?.hide(overlayKey);
            return;
        }

        const sheetNode = (
            <ModalShell
                standalone
                visible
                onClose={close}
                variant="bottom"
                keyboardAvoid={{
                    kind: 'adaptive',
                    maxHeightRatio: 0.75,
                    iosTranslateY: true,
                }}
                panelStyle={styles.sheet}
            >
                <Text style={[styles.sheetTitle, {color: tokens.text}]}>{coreT({key: "ui.agent.select_tools"})}</Text>
                <View style={styles.searchWrap}>
                    <FormTextInput tokens={tokens} value={query} onChangeText={setQuery} placeholder={coreT({key: "ui.agent.search_tools_placeholder"})} />
                </View>
                <FlatList
                    data={filtered}
                    keyExtractor={item => item.name}
                    style={styles.list}
                    renderItem={({item}) => {
                        if (item.placeholder) {
                            return (
                                <View style={[styles.row, {borderBottomColor: tokens.border}]}>
                                    <Text style={{color: tokens.textSecondary, fontSize: 13}}>{item.description}</Text>
                                </View>
                            );
                        }
                        const active = draftSet.has(item.name);
                        return (
                            <Pressable style={[styles.row, {borderBottomColor: tokens.border}, active && {backgroundColor: tokens.bgSecondary}]} onPress={() => toggle(item.name)}>
                                <View style={styles.rowText}>
                                    <Text style={{color: tokens.text}}>{item.name}</Text>
                                    <Text style={{color: tokens.textSecondary, fontSize: 13}}>{item.description}</Text>
                                </View>
                                {active ? <Text style={{color: tokens.primary}}>✓</Text> : null}
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
                        <Text style={{color: tokens.textSecondary}}>{coreT({key: "ui.common.cancel"})}</Text>
                    </Pressable>
                    <Pressable onPress={confirm} style={[styles.actionBtn, {backgroundColor: tokens.primary}]}>
                        <Text style={styles.confirmText}>{coreT({key: "ui.common.confirm"})}</Text>
                    </Pressable>
                </View>
            </ModalShell>
        );
        overlay.show(overlayKey, sheetNode);

        return () => overlay.hide(overlayKey);
    };
    const sheetDeps = [open, overlay, overlayKey, filtered, draft, draftSet, query, tokens, insets.bottom, close, confirm, toggle];
    useEffect(showSheet, sheetDeps);

    let triggerLabel: string;
    if (selected.length === 0) {
        triggerLabel = coreT({key: "ui.agent.no_tools_selected", params: {total: String(total)}});
    } else if (selected.length >= total) {
        triggerLabel = coreT({key: "ui.agent.all_tools_selected", params: {total: String(total)}});
    } else {
        triggerLabel = coreT({key: "ui.agent.selected_tools_aria", params: {selected: String(selected.length), total: String(total)}});
    }

    return (
        <Pressable
            disabled={disabled}
            style={[
                styles.trigger,
                {
                    backgroundColor: tokens.bgSecondary,
                    borderColor: tokens.borderLight,
                    opacity: disabled ? 0.55 : 1,
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
    sheet: {
        // maxHeight（含键盘收缩）由 ModalShell 的 adaptive 策略管
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
