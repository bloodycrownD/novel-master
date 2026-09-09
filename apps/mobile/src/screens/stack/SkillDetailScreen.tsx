/**
 * 技能详情页：技能元信息（描述 + 编辑信息入口）+ 内嵌文件浏览器（SkillFileManager）。
 *
 * - 列表数据来自 listSkills（按域），找不到技能（被并行删除等）时安全踢回管理页。
 * - 打开文件跳 FileEditor 的 skill scope（skillRef 带域定位，路径锚定
 *   /meta/skills/{name}/{rel}）。
 * - 文件结构变化（新建/删除辅助文件）后刷新清单。
 * - 「编辑信息」（重命名 + 描述）成功后 setParams 同步栈内定位，避免
 *   改名后 reload 按旧名查不到被误踢回。
 */
import React, {useCallback, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {SkillListItem} from '@novel-master/core/skills';
import type {VfsScope} from '@novel-master/core/vfs';
import {
  VfsFileManager,
  type VfsFileManagerHandle,
} from '@/components/vfs/VfsFileManager';
import {
  SkillInfoEditModal,
  type SkillInfoTarget,
} from '@/components/skills/SkillInfoEditModal';
import {skillDomainHintLabel} from '@/components/skills/skill-ui';
import {useRuntime} from '@/hooks/useRuntime';
import {useVfsBackNavigation} from '@/hooks/useVfsBackNavigation';
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
  const [loading, setLoading] = useState(true);
  const [infoEditOpen, setInfoEditOpen] = useState(false);
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
    } catch (error) {
      showToast(toastMessage('加载技能失败', error));
    } finally {
      setLoading(false);
    }
  }, [runtime, domain, projectId, name, showToast, navigation]);

  // 标题 = 技能名；返回上翻三件套（header 覆盖/硬件返回/侧滑手势）见 hook 内注释。
  const fileRef = useRef<VfsFileManagerHandle>(null);
  const {syncGestureEnabled} = useVfsBackNavigation(fileRef, navigation, {
    title: name,
  });

  useFocusEffect(
    useCallback(() => {
      reload().catch(() => undefined);
    }, [reload]),
  );

  const skillRoot = `/meta/skills/${name}`;
  const skillInfoTarget: SkillInfoTarget = {
    domain,
    name,
    ...(domain === 'project' && projectId != null ? {projectId} : {}),
  };
  // 技能域直接复用 VfsFileManager（workplace 不传，纳入/目录规则菜单自动隐藏）。
  // 技能已重定位到独立 meta 域，这里取 meta 域 vfs/scope（逻辑路径 /meta/skills 不变）。
  // SKILL.md 是技能入口，拦截删除/重命名/移动，其余文件全功能开放（含新建目录）。
  const fileScope: VfsScope =
    domain === 'global'
      ? {kind: 'global-meta'}
      : {kind: 'project-meta', projectId: projectId!};
  const fileVfs =
    domain === 'global'
      ? runtime.globalMetaVfs()
      : runtime.projectMetaVfs(projectId!);

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
      <View
        style={[
          styles.root,
          styles.center,
          {backgroundColor: tokens.background},
        ]}
      >
        <ActivityIndicator color={tokens.primary} />
      </View>
    );
  }

  if (item == null) {
    return (
      <View
        style={[
          styles.root,
          styles.center,
          {backgroundColor: tokens.background},
        ]}
      >
        <Text style={{color: tokens.textSecondary}}>技能不存在或已被删除</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, {backgroundColor: tokens.background}]}>
      <View style={[styles.metaRow, {borderColor: tokens.borderLight}]}>
        <View style={styles.metaBody}>
          <Text
            style={[styles.metaDomain, {color: tokens.textTertiary}]}
            numberOfLines={1}
          >
            {skillDomainHintLabel(domain, projectId)}
          </Text>
          {item.description ? (
            <Text
              style={[styles.metaDesc, {color: tokens.textSecondary}]}
              numberOfLines={1}
            >
              {item.description}
            </Text>
          ) : null}
        </View>
        <Pressable
          testID="skill-detail-edit-info"
          hitSlop={8}
          disabled={!item.valid}
          onPress={() => setInfoEditOpen(true)}
        >
          <Text
            style={{
              color: item.valid ? tokens.primary : tokens.textTertiary,
              fontSize: 13,
            }}
          >
            {item.valid ? '编辑信息' : '先修 SKILL.md'}
          </Text>
        </Pressable>
      </View>
      <VfsFileManager
        ref={fileRef}
        // 目录变化时同步侧滑手势开关：根目录开（侧滑退出），子目录关（防误退）。
        onDirectoryChange={syncGestureEnabled}
        scope={fileScope}
        vfs={fileVfs}
        rootPath={skillRoot}
        onOpenFile={openFile}
        isProtectedPath={path =>
          path === `${skillRoot}/SKILL.md`
            ? 'SKILL.md 是技能入口文件，不能删除或重命名'
            : null
        }
        pathLabel={path =>
          path === skillRoot ? '/' : path.slice(skillRoot.length)
        }
      />
      <SkillInfoEditModal
        visible={infoEditOpen}
        target={skillInfoTarget}
        currentDescription={item.description}
        onClose={() => setInfoEditOpen(false)}
        onSaved={newName => {
          // 改名后同步栈内定位：route.params.name 变化驱动 reload 按
          // 新名重取（含标题与文件根路径），否则 reload 按旧名查不到
          // 会被误踢回。
          if (newName !== name) {
            navigation.setParams({name: newName});
          } else {
            reload().catch(() => undefined);
          }
          showToast('已保存技能信息');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  center: {justifyContent: 'center', alignItems: 'center'},
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaBody: {flex: 1, gap: 2},
  metaDomain: {fontSize: 12},
  metaDesc: {fontSize: 13},
});
