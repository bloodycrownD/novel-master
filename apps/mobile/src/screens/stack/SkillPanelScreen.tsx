/**
 * 会话技能面板：当前项目合并视图（全局 ∪ 项目、同名项目覆盖）。
 *
 * - 列表行：技能名 + 域徽标三态 + 无效标签（含原因）+ 描述 + 启用开关；
 *   开关写当前项目的负清单（关闭只影响当前项目）。
 * - 点行（开关区域外）进技能详情页；关闭态行整体弱化。
 * - 头部动作：「整理」跳设置·技能管理页；「新建」弹窗默认项目域。
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RouteProp} from '@react-navigation/native';
import type {EffectiveSkill} from '@novel-master/core/skills';
import {isVfsError} from '@novel-master/core/vfs';
import {NewSkillModal} from '@/components/skills/NewSkillModal';
import {
  skillDomainBadgeColor,
  skillDomainBadgeLabel,
} from '@/components/skills/skill-ui';
import {ManageListIcon} from '@/components/icons/TabIcons';
import {SecondaryButton} from '@/components/ui/PrototypeButtons';
import {useRuntime} from '@/hooks/useRuntime';
import {useHeaderContext} from '@/navigation/HeaderContext';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type PanelRoute = RouteProp<RootStackParamList, 'SkillPanel'>;

export function SkillPanelScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<PanelRoute>();
  const {projectId} = route.params;

  const [skills, setSkills] = useState<EffectiveSkill[]>([]);
  const [loading, setLoading] = useState(true);
  // 防连点用 ref：不驱动渲染，避免开关 disabled 灰态与 value 更量叠加造成抖动
  const togglingRef = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);

  const reload = useCallback(
    async (opts?: {silent?: boolean}) => {
      // 静默刷新（聚焦返回）不拉下拉指示器、不重建列表视觉
      if (!opts?.silent) {
        setLoading(true);
      }
      try {
        setSkills(await runtime.skills().effectiveSkills(projectId));
      } catch (error) {
        // 技能根目录尚不存在 = 空列表（与服务层向 NOT_FOUND 语义对齐），不弹错
        if (isVfsError(error, 'NOT_FOUND')) {
          setSkills([]);
        } else {
          showToast(toastMessage('加载技能失败', error));
        }
      } finally {
        // 结尾无条件清 loading：静默刷新若给 loading 置过 true 也要复位
        setLoading(false);
      }
    },
    [runtime, projectId, showToast],
  );

  useFocusEffect(
    useCallback(() => {
      reload({silent: true}).catch(() => undefined);
    }, [reload]),
  );

  // 右上角 header 菜单位 = 「管理」入口（跳技能管理页），列表管理 icon 区别于菜单汉堡
  const {setStackOverride} = useHeaderContext();
  useEffect(() => {
    setStackOverride({
      showMenu: true,
      menuIcon: <ManageListIcon color={tokens.text} />,
      onMenu: () => navigation.navigate('SkillsSettings'),
    });
    return () => setStackOverride(undefined);
  }, [setStackOverride, navigation, tokens.text]);

  const toggleDisabled = useCallback(
    async (skill: EffectiveSkill, nextEnabled: boolean) => {
      if (togglingRef.current) {
        return;
      }
      togglingRef.current = true;
      // 乐观更新：拨动瞬间即翻转 value，失败再回滚（无中间灰态/回跳）
      const flip = (enabled: boolean) =>
        setSkills(prev =>
          prev.map(s =>
            s.name === skill.name ? {...s, disabled: !enabled} : s,
          ),
        );
      flip(nextEnabled);
      try {
        await runtime
          .skills()
          .setDisabled(projectId, skill.name, !nextEnabled);
      } catch (error) {
        flip(!nextEnabled);
        showToast(toastMessage(nextEnabled ? '启用失败' : '关闭失败', error));
      } finally {
        togglingRef.current = false;
      }
    },
    [runtime, projectId, showToast],
  );

  const openDetail = (skill: EffectiveSkill) => {
    // 面板是合并视图：同名项目副本覆盖时跳项目域原件，否则按条目自身域
    navigation.navigate('SkillDetail', {
      domain: skill.domain,
      name: skill.name,
      ...(skill.domain === 'project' ? {projectId} : {}),
    });
  };

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      {loading && skills.length === 0 ? (
        <ActivityIndicator style={styles.loader} color={tokens.primary} />
      ) : (
        <FlatList
          data={skills}
          keyExtractor={item => `${item.domain}:${item.name}`}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => reload()} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={[styles.emptyText, {color: tokens.textSecondary}]}>
                当前项目还没有可用技能。技能是可复用的说明文档，
                创建后进入提示词索引，模型会按描述决定是否使用。
              </Text>
              <SecondaryButton
                label="新建技能"
                tokens={tokens}
                onPress={() => setCreateOpen(true)}
              />
            </View>
          }
          renderItem={({item}) => (
            <Pressable
              testID={`skill-panel-row-${item.name}`}
              style={[
                styles.row,
                {backgroundColor: tokens.surface, borderColor: tokens.borderLight},
                (item.disabled || !item.valid) && styles.rowDimmed,
              ]}
              onPress={() => openDetail(item)}
              accessibilityLabel={`技能 ${item.name}`}>
              <View style={styles.rowBody}>
                <View style={styles.titleRow}>
                  <Text
                    style={[styles.name, {color: tokens.text}]}
                    numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text
                    style={[
                      styles.badge,
                      {
                        color: skillDomainBadgeColor(item.domain, tokens),
                        borderColor: tokens.border,
                      },
                    ]}>
                    {skillDomainBadgeLabel(item.domain, item.overridden)}
                  </Text>
                  {!item.valid ? (
                    <Text
                      style={[styles.invalidTag, {color: tokens.danger}]}
                      numberOfLines={1}>
                      无效 · {item.invalidReason ?? 'front matter 不合法'}
                    </Text>
                  ) : null}
                </View>
                {item.description ? (
                  <Text
                    style={[styles.description, {color: tokens.textSecondary}]}
                    numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <Switch
                value={!item.disabled}
                disabled={!item.valid}
                onValueChange={next => toggleDisabled(item, next).catch(() => undefined)}
                trackColor={{false: tokens.border, true: tokens.primary}}
              />
            </Pressable>
          )}
        />
      )}
      <NewSkillModal
        visible={createOpen}
        domain="project"
        defaultProjectId={projectId}
        onClose={() => setCreateOpen(false)}
        onCreated={target => {
          showToast('已创建');
          navigation.navigate('SkillDetail', {
            domain: target.domain,
            name: target.name,
            ...(target.projectId != null ? {projectId: target.projectId} : {}),
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  loader: {marginTop: 32},
  listContent: {padding: 12, gap: 8, paddingBottom: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowDimmed: {opacity: 0.55},
  rowBody: {flex: 1, gap: 4},
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  name: {fontSize: 15, fontWeight: '600'},
  badge: {
    fontSize: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  invalidTag: {fontSize: 11, flexShrink: 1},
  description: {fontSize: 13, lineHeight: 18},
  empty: {padding: 32, gap: 16, alignItems: 'center'},
  emptyText: {fontSize: 13, lineHeight: 20, textAlign: 'center'},
});
