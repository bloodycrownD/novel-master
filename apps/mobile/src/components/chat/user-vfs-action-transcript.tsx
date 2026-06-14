/**
 * Transcript 内 `<user-vfs-action>` 最小展开渲染（legacy RN 路径）。
 */
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

export type ParsedUserVfsEditHunk = {
  readonly index: string;
  readonly old: string;
  readonly new: string;
};

export type ParsedUserVfsAction = {
  readonly kind: string;
  readonly path: string;
  readonly method?: string;
  readonly hunks: readonly ParsedUserVfsEditHunk[];
};

const USER_VFS_ACTION_RE =
  /<user-vfs-action\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/user-vfs-action>)/;
const EDIT_HUNK_RE =
  /<edit-hunk[^>]*index="(\d+)"[^>]*>[\s\S]*?<old>([\s\S]*?)<\/old>[\s\S]*?<new>([\s\S]*?)<\/new>[\s\S]*?<\/edit-hunk>/g;

/** 从 user 消息纯文本解析首个 user-vfs-action；非 VFS 操作返回 null。 */
export function parseUserVfsActionFromText(
  text: string,
): ParsedUserVfsAction | null {
  if (!text.includes('<user-vfs-action')) {
    return null;
  }
  const match = text.match(USER_VFS_ACTION_RE);
  if (match == null) {
    return null;
  }
  const attrs = match[1] ?? '';
  const inner = match[2] ?? '';
  const kind = attrs.match(/kind="([^"]+)"/)?.[1] ?? '';
  const path = attrs.match(/path="([^"]+)"/)?.[1] ?? '';
  const method = attrs.match(/method="([^"]+)"/)?.[1];
  const hunks: ParsedUserVfsEditHunk[] = [];
  const hunkRe = new RegExp(EDIT_HUNK_RE.source, 'g');
  let hm: RegExpExecArray | null;
  while ((hm = hunkRe.exec(inner)) !== null) {
    hunks.push({index: hm[1] ?? '', old: hm[2] ?? '', new: hm[3] ?? ''});
  }
  return {kind, path, method, hunks};
}

type UserVfsActionBodyProps = {
  readonly action: ParsedUserVfsAction;
  readonly bodyColor: string;
};

/** user 气泡内 VFS 操作卡片（可折叠 edit-hunk）。 */
export function UserVfsActionBody({action, bodyColor}: UserVfsActionBodyProps) {
  const {tokens} = useTheme();
  const labelColor = bodyColor === '#fff' ? 'rgba(255,255,255,0.75)' : tokens.textSecondary;

  return (
    <View style={styles.card}>
      <Text style={[styles.title, {color: bodyColor}]}>
        {action.kind} · {action.path}
      </Text>
      {action.method ? (
        <Text style={[styles.meta, {color: labelColor}]}>
          method: {action.method}
        </Text>
      ) : null}
      {action.hunks.map(hunk => (
        <View key={hunk.index} style={styles.hunk}>
          <Text style={[styles.hunkTitle, {color: bodyColor}]}>
            edit-hunk #{hunk.index}
          </Text>
          <Text style={[styles.hunkLabel, {color: labelColor}]}>old</Text>
          <Text style={[styles.hunkText, {color: bodyColor}]}>{hunk.old}</Text>
          <Text style={[styles.hunkLabel, {color: labelColor}]}>new</Text>
          <Text style={[styles.hunkText, {color: bodyColor}]}>{hunk.new}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {gap: 6},
  title: {fontSize: 14, fontWeight: '600'},
  meta: {fontSize: 12},
  hunk: {marginTop: 4, gap: 2},
  hunkTitle: {fontSize: 13, fontWeight: '500'},
  hunkLabel: {fontSize: 11, fontWeight: '600'},
  hunkText: {fontSize: 12, lineHeight: 16},
});
