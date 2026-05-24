import React from 'react';
import {Button, StyleSheet, Text, View} from 'react-native';

type Props = {
  onOpenVfs: () => void;
  onOpenSksp: () => void;
  vfsReady: boolean;
  vfsError: string | null;
};

/** Entry screen: explains device DB vs CLI and links to the VFS dev page. */
export function HomeScreen({onOpenVfs, onOpenSksp, vfsReady, vfsError}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Novel Master</Text>
      <Text style={styles.body}>
        Mobile scaffold for workspace VFS validation. The on-device database (
        novel_master_vfs) is separate from the CLI database under
        .novel-master/novel.db; operations share the same API semantics.
      </Text>
      {!vfsReady && !vfsError && (
        <Text style={styles.status}>VFS initializing…</Text>
      )}
      {vfsError != null && (
        <Text style={styles.error} testID="vfs-init-error">
          {vfsError}
        </Text>
      )}
      <Button
        title="Open VFS dev screen"
        onPress={onOpenVfs}
        disabled={!vfsReady}
      />
      <View style={styles.gap} />
      <Button
        title="Open SKSP dev screen"
        onPress={onOpenSksp}
        disabled={!vfsReady}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
  },
  body: {
    fontSize: 14,
    marginBottom: 16,
    lineHeight: 20,
  },
  status: {
    fontSize: 14,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  error: {
    fontSize: 14,
    color: '#b00020',
    marginBottom: 12,
  },
  gap: {height: 12},
});
