/**
 * Provider list → detail navigation.
 */
import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ProviderListItem} from '@novel-master/core';
import {formatApplicationModelId} from '@novel-master/core';
import {useRuntime} from '../../hooks/useRuntime';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;

interface ProviderRow extends ProviderListItem {
  savedCount: number;
  samplingCount: number;
}

export function ProvidersScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const providers = await runtime.providers.list();
      const enriched: ProviderRow[] = [];
      for (const provider of providers) {
        const saved = await runtime.providerModels.savedList(provider.id);
        let samplingCount = 0;
        for (const model of saved) {
          const applicationModelId = formatApplicationModelId(
            provider.id,
            model.vendorModelId,
          );
          const profile =
            await runtime.modelSamplingProfiles.getProfile(applicationModelId);
          if (profile?.enabled && profile.params) {
            samplingCount += 1;
          }
        }
        enriched.push({
          ...provider,
          savedCount: saved.length,
          samplingCount,
        });
      }
      setRows(enriched);
    } finally {
      setLoading(false);
    }
  }, [runtime]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => setRows([]));
    }, [reload]),
  );

  const metaLine = (row: ProviderRow) => {
    let meta = `${row.savedCount} 个已保存模型`;
    if (row.samplingCount > 0) {
      meta += ` · ${row.samplingCount} 个已配采样`;
    }
    return meta;
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无服务商。服务商 CRUD 将在后续版本提供。
            </Text>
          }
          renderItem={({item}) => (
            <Pressable
              style={[styles.row, {borderBottomColor: tokens.border}]}
              onPress={() =>
                navigation.navigate('ProviderDetail', {providerId: item.id})
              }>
              <Text style={styles.icon}>🟢</Text>
              <View style={styles.info}>
                <Text style={[styles.name, {color: tokens.text}]}>
                  {item.displayName?.trim() || item.id}
                </Text>
                <Text style={[styles.meta, {color: tokens.textSecondary}]}>
                  {metaLine(item)}
                </Text>
              </View>
              <Text style={{color: tokens.textSecondary}}>›</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  icon: {fontSize: 20},
  info: {flex: 1, gap: 2},
  name: {fontSize: 16, fontWeight: '500'},
  meta: {fontSize: 13},
});
