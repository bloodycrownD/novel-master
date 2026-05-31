/**
 * Saved models for one provider; add model + navigate to sampling.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import {formatApplicationModelId} from '@novel-master/core';
import {AddModelModal} from '../../components/provider/AddModelModal';
import {BottomSheetMenu} from '../../components/sheet/BottomSheetMenu';
import {useRuntime} from '../../hooks/useRuntime';
import {useHeaderContext} from '../../navigation/HeaderContext';
import {resolveModelDisplayLabel} from '../../provider/model-display-label';
import type {RootStackParamList} from '../../navigation/types';
import {useTheme} from '../../theme/ThemeProvider';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'ProviderDetail'>;

interface ModelRow {
  vendorModelId: string;
  applicationModelId: string;
  label: string;
  hasSampling: boolean;
}

export function ProviderDetailScreen() {
  const {tokens} = useTheme();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const providerId = route.params?.providerId;
  const {setStackOverride} = useHeaderContext();

  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [menuVendorId, setMenuVendorId] = useState<string | undefined>();

  const reload = useCallback(async () => {
    if (!providerId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const provider = await runtime.providers.get(providerId);
      setStackOverride({title: provider.displayName?.trim() || provider.id});
      const saved = await runtime.providerModels.savedList(providerId);
      const enriched: ModelRow[] = [];
      for (const model of saved) {
        const applicationModelId = formatApplicationModelId(
          providerId,
          model.vendorModelId,
        );
        const profile =
          await runtime.modelSamplingProfiles.getProfile(applicationModelId);
        const hasSampling = Boolean(profile?.enabled && profile.params);
        let label = model.displayName?.trim() || model.vendorModelId;
        try {
          label = await resolveModelDisplayLabel(runtime, applicationModelId);
        } catch {
          /* fallback */
        }
        enriched.push({
          vendorModelId: model.vendorModelId,
          applicationModelId,
          label,
          hasSampling,
        });
      }
      setRows(enriched);
    } catch (error) {
      Alert.alert(
        '加载失败',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setLoading(false);
    }
  }, [runtime, providerId, setStackOverride]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
      return () => setStackOverride(undefined);
    }, [reload, setStackOverride]),
  );

  useEffect(() => {
    if (!providerId) {
      Alert.alert('错误', '缺少 providerId', [
        {text: '返回', onPress: () => navigation.goBack()},
      ]);
    }
  }, [providerId, navigation]);

  const handleAdd = async (vendorModelId: string, displayName?: string) => {
    if (!providerId) {
      return;
    }
    await runtime.providerModels.save(providerId, vendorModelId, displayName);
    await reload();
    Alert.alert('已添加模型');
  };

  const handleDelete = async (vendorModelId: string) => {
    if (!providerId) {
      return;
    }
    const applicationModelId = formatApplicationModelId(
      providerId,
      vendorModelId,
    );
    Alert.alert('删除模型', `确定删除 ${applicationModelId}？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          (async () => {
            await runtime.providerModels.deleteSaved(providerId, vendorModelId);
            await runtime.modelSamplingProfiles.clearProfile(applicationModelId);
            await reload();
            Alert.alert('已删除模型');
          })().catch(err =>
            Alert.alert(
              '删除失败',
              err instanceof Error ? err.message : String(err),
            ),
          );
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <View style={[styles.toolbar, {borderBottomColor: tokens.border}]}>
        <Pressable
          style={[styles.addBtn, {backgroundColor: tokens.primary}]}
          onPress={() => setAddVisible(true)}>
          <Text style={styles.addBtnText}>添加模型</Text>
        </Pressable>
      </View>
      {loading && rows.length === 0 ? (
        <ActivityIndicator style={styles.loader} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.vendorModelId}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            <Text style={[styles.empty, {color: tokens.textSecondary}]}>
              暂无已保存模型，点击「添加模型」登记 vendorModelId。
            </Text>
          }
          renderItem={({item}) => (
            <Pressable
              style={[styles.row, {borderBottomColor: tokens.border}]}
              onPress={() =>
                navigation.navigate('ModelSampling', {
                  applicationModelId: item.applicationModelId,
                })
              }>
              <View style={styles.info}>
                <Text style={[styles.name, {color: tokens.text}]}>
                  {item.label}
                </Text>
                <Text style={[styles.meta, {color: tokens.textSecondary}]}>
                  {item.applicationModelId}
                  {item.hasSampling ? ' · 已配采样' : ''}
                </Text>
              </View>
              <Pressable
                hitSlop={8}
                onPress={e => {
                  e.stopPropagation?.();
                  setMenuVendorId(item.vendorModelId);
                }}>
                <Text style={{color: tokens.textSecondary, fontSize: 18}}>
                  ⋮
                </Text>
              </Pressable>
              <Text style={{color: tokens.textSecondary}}>›</Text>
            </Pressable>
          )}
        />
      )}
      <AddModelModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onConfirm={handleAdd}
      />
      <BottomSheetMenu
        visible={menuVendorId != null}
        items={[{label: '删除模型', action: 'delete', danger: true}]}
        onClose={() => setMenuVendorId(undefined)}
        onSelect={action => {
          if (action === 'delete' && menuVendorId) {
            handleDelete(menuVendorId).catch(() => undefined);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: {color: '#fff', fontWeight: '600'},
  loader: {marginTop: 32},
  empty: {textAlign: 'center', padding: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  info: {flex: 1, gap: 2},
  name: {fontSize: 16, fontWeight: '500'},
  meta: {fontSize: 12},
});
