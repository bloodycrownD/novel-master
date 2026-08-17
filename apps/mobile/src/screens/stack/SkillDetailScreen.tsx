/**
 * 技能详情页：技能元信息 + 内嵌文件浏览器（SkillFileManager）。
 *
 * - 列表数据来自 listSkills（按域），找不到技能（被并行删除等）时安全踢回管理页。
 * - 打开文件跳 FileEditor 的 skill scope（skillRef 带域定位，路径锚定
 *   /meta/skills/{name}/{rel}）。
 * - 文件结构变化（新建/删除辅助文件）后刷新清单。
 */
import React, {useCallback, useRef, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {SkillListItem} from '@novel-master/core/skills';
import type {VfsScope} from '@novel-master/core/vfs';
import {VfsFileManager} from '@/components/vfs/VfsFileManager';
import {
  skillDomainBadgeColor,
  skillDomainBadgeLabel,
  skillDomainHintLabel,
} from '@/components/skills/skill-ui';
import {useRuntime} from '@/hooks/useRuntime';
import type {RootStackParamList} from '@/navigation/types';
import {useTheme} from '@/theme/ThemeProvider';
import {useToast} from '@/components/chrome/ToastHost';
import {toastMessage} from '@/errors/toast-message';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DetailRoute = RouteProp<RootStackParamList, 'SkillDetail'>;

export function SkillDetailScreen() {
  const {tokens} = useTheme();
  const {showToast} = useToast();
  const runtime = useRuntime();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailRoute>();
  const {domain, name, projectId} = route.params;

  const [item, setItem] = useState<SkillListItem | null>(null);
  const [projectName, setProjectName] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  // 踢回只做一次：reload 多次 notFound 也只弹一次 toast + goBack
  const kickedRef = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await runtime
        .skills()
        .listSkills(domain === 'global' ? 'global' : {projectId: projectId!});
      const found = list.find(entry => entry.name === name) ?? null;
      setItem(found);
      if (found == null && !kickedRef.current) {
        kickedRef.current = true;
        showToast('技能不存在或已被删除');
        navigation.goBack();
        return;
      }
      if (domain === 'project' && projectId != null) {
        const projects = await runtime.projects.list();
        setProjectName(projects.find(p => p.id === projectId)?.name);
      }
    } catch (error) {
      showToast(toastMessage('加载技能失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, domain, projectId, name, showToast, navigation]);

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  const skillRoot = `/meta/skills/${name}`;
  // 技能域直接复用 VfsFileManager（workplace 不传，纳入/目录规则菜单自动隐藏）。
  // SKILL.md 是技能入口，拦截删除/重命名/移动，其余文件全功能开放（含新建目录）。
  const fileScope: VfsScope =
    domain === 'global'
      ? {kind: 'global'}
      : {kind: 'project', projectId: projectId!};
  const fileVfs =
    domain === 'global'
      ? runtime.globalVfs()
      : runtime.projectVfs(projectId!);

  const openFile = useCallback(
    (fullPath: string) => {
      navigation.navigate('FileEditor', {
        path: fullPath,
        scopeKind: 'skill',
        skillRef: {
          domain,
          name,
          ...(domain === 'project' && projectId != null ? {projectId} : {}),
        },
      });
    },
    [navigation, domain, name, projectId],
  );

  if (loading && item == null) {
    return (
      <View style={[styles.root, styles.center, {backgroundColor: tokens.background}]}>
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  if (item == null) {
    return (
      <View style={[styles.root, styles.center, {backgroundColor: tokens.background}]}>
        <Text style={{color: tokens.textSecondary}}>技能不存在或已被删除</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <View style={[styles.meta, {borderBottomColor: tokens.border}]}>
        <View style={styles.metaTitleRow}>
          <Text style={[styles.metaName, {color: tokens.text}]} numberOfLines={1}>
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
            {skillDomainBadgeLabel(item.domain, false)}
          </Text>
        </View>
        <Text style={[styles.metaHint, {color: tokens.textTertiary}]} numberOfLines={1}>
          {skillDomainHintLabel(item.domain, projectName)}
        </Text>
        {!item.valid ? (
          <Text style={[styles.invalidTag, {color: tokens.danger}]} numberOfLines={2}>
            无效 · {item.invalidReason ?? 'front matter 不合法'}
          </Text>
        ) : item.description ? (
          <Text
            style={[styles.metaDesc, {color: tokens.textSecondary}]}
            numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
      </View>
      <VfsFileManager
        scope={fileScope}
        vfs={fileVfs}
        rootPath={skillRoot}
        onOpenFile={openFile}
        isProtectedPath={path =>
          path === `${skillRoot}/SKILL.md`
            ? 'SKILL.md 是技能入口文件，不能删除或重命名'
            : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {justifyContent: 'center', alignItems: 'center'},
  meta: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  metaName: {fontSize: 17, fontWeight: '700'},
  badge: {
    fontSize: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  metaHint: {fontSize: 12},
  metaDesc: {fontSize: 13, lineHeight: 18},
  invalidTag: {fontSize: 12, lineHeight: 16},
});
