import React from 'react';
import {Pressable, Text, View} from 'react-native';
import type {UsageStatsRequestRow} from '@novel-master/core/chat';
import {TokenFormat} from '@novel-master/core/common';
import {ListSectionTitle} from '../../../components/ui/ListSectionTitle';
import type {ThemeTokens} from '../../../theme/tokens';
import {coreT} from '@/i18n/core';
import {REQUESTS_PAGE_SIZE} from './format';
import {styles} from './styles';

/**
 * 流水页签（screens/C-4 拆分自主文件）：请求级分页列表（时间倒序，
 * 按需加载），分页条复用 core 的 TokenFormat.pageWindow。dirty 标记由父层
 * 维护（筛选变化置位、加载完成/失败清除），本组件只消费布尔值。
 */
export function RequestsTab({
    reqRows,
    reqTotal,
    reqPage,
    reqLoading,
    reqDirty,
    onLoadRequests,
    tokens,
}: {
    reqRows: UsageStatsRequestRow[];
    reqTotal: number;
    reqPage: number;
    reqLoading: boolean;
    /** 父层 reqDirtyRef.current：仍为脏说明首页加载未完成，不展示「无请求记录」。 */
    reqDirty: boolean;
    onLoadRequests: (page: number) => Promise<void>;
    tokens: ThemeTokens;
}) {
    return (
        <>
            <ListSectionTitle title={coreT({key: "ui.stats.requests_title", params: {count: String(reqTotal)}})} tokens={tokens} />
            {reqRows.map((row, index) => (
                <View
                    // 与 desktop 口径一致：createdAtMs+index，防同毫秒同模型碰撞（MF-5）。
                    key={`${row.createdAtMs}-${index}`}
                    style={[styles.reqRow, {backgroundColor: tokens.surface}]}
                >
                    <View style={styles.reqRowHead}>
                        <Text style={{color: tokens.text}}>{TokenFormat.requestTime(row.createdAtMs)}</Text>
                        <Text numberOfLines={1} style={{color: tokens.textSecondary, flexShrink: 1}}>
                            {coreT({key: "ui.stats.col_first_token"})} {TokenFormat.durationMs(row.firstTokenMs)} · {coreT({key: "ui.stats.col_total_time"})} {TokenFormat.durationMs(row.durationMs)}
                        </Text>
                    </View>
                    <Text numberOfLines={1} style={[styles.reqRowDetail, {color: tokens.textSecondary}]}>
                        {row.modelName ?? coreT({key: "ui.stats.model_other"})} · {coreT({key: "ui.stats.input_label"})} {TokenFormat.count(row.promptTokens)} · {coreT({key: "ui.stats.output_label"})} {TokenFormat.count(row.completionTokens)} · {coreT({key: "ui.stats.col_cache_read"})}{' '}
                        {row.cacheReadTokens == null ? '—' : TokenFormat.count(row.cacheReadTokens)}
                    </Text>
                </View>
            ))}
            {reqTotal > 0 ? (
                <View style={[styles.reqPager]}>
                    <Pressable
                        testID="req-prev-page"
                        style={[styles.reqPagerBtn, {borderColor: tokens.borderLight}]}
                        disabled={reqLoading || reqPage === 0}
                        onPress={() => onLoadRequests(reqPage - 1).catch(() => undefined)}
                    >
                        <Text style={{color: tokens.primary}}>{coreT({key: "ui.stats.page_prev"})}</Text>
                    </Pressable>
                    {TokenFormat.pageWindow(reqPage + 1, Math.max(1, Math.ceil(reqTotal / REQUESTS_PAGE_SIZE))).map((item, index) =>
                        item === '…' ? (
                            <Text key={`gap-${index}`} style={[styles.reqPageGap, {color: tokens.textTertiary}]}>
                                …
                            </Text>
                        ) : (
                            <Pressable
                                key={`page-${item}`}
                                testID={`req-page-${item}`}
                                style={[
                                    styles.reqPageNum,
                                    item === reqPage + 1 && {backgroundColor: tokens.selection},
                                    {
                                        borderColor: item === reqPage + 1 ? tokens.primary : tokens.borderLight,
                                    },
                                ]}
                                disabled={reqLoading}
                                onPress={() => onLoadRequests(item - 1).catch(() => undefined)}
                            >
                                <Text
                                    style={{
                                        color: item === reqPage + 1 ? tokens.primary : tokens.textSecondary,
                                        fontWeight: item === reqPage + 1 ? '600' : '400',
                                    }}
                                >
                                    {String(item)}
                                </Text>
                            </Pressable>
                        ),
                    )}
                    <Pressable
                        testID="req-next-page"
                        style={[styles.reqPagerBtn, {borderColor: tokens.borderLight}]}
                        disabled={reqLoading || (reqPage + 1) * REQUESTS_PAGE_SIZE >= reqTotal}
                        onPress={() => onLoadRequests(reqPage + 1).catch(() => undefined)}
                    >
                        <Text style={{color: tokens.primary}}>{coreT({key: "ui.stats.page_next"})}</Text>
                    </Pressable>
                </View>
            ) : null}
            {reqRows.length === 0 && !reqLoading && !reqDirty ? <Text style={[styles.reqRowDetail, {color: tokens.textSecondary}]}>{coreT({key: "ui.stats.requests_empty"})}</Text> : null}
        </>
    );
}
