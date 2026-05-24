import React, {useCallback, useState} from 'react';
import {
  Button,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {VfsError, type VfsService, type WriteOptions} from '@novel-master/core';
import {formatVfsError} from '../vfs/errors';
import {getVfs} from '../vfs/runtime';

type Props = {
  onBack: () => void;
};

/** Write semantics aligned with CLI `runWrite` (conflict unless no-version-check). */
async function vfsWrite(
  vfs: VfsService,
  path: string,
  content: string,
  noVersionCheck: boolean,
): Promise<number> {
  const options: WriteOptions = noVersionCheck ? {versionCheck: false} : {};
  try {
    const existing = await vfs.read(path);
    if (!noVersionCheck) {
      throw new VfsError(
        'CONFLICT',
        `Path exists; pass --version ${existing.version} or --no-version-check`,
        {path},
      );
    }
  } catch (error) {
    if (!(error instanceof VfsError) || error.code !== 'NOT_FOUND') {
      throw error;
    }
  }
  const result = await vfs.write(path, content, options);
  return result.version;
}

/**
 * Development UI for list/read/write/replace/delete/glob (CLI-aligned, no grep).
 */
export function VfsDevScreen({onBack}: Props) {
  const [result, setResult] = useState('');

  const [listDir, setListDir] = useState('/');
  const [listRecursive, setListRecursive] = useState(false);
  const [listDepth, setListDepth] = useState('');

  const [readPath, setReadPath] = useState('/dev/note.md');

  const [writePath, setWritePath] = useState('/dev/note.md');
  const [writeText, setWriteText] = useState('hello');
  const [writeNoVersionCheck, setWriteNoVersionCheck] = useState(true);

  const [replacePath, setReplacePath] = useState('/dev/note.md');
  const [replaceOld, setReplaceOld] = useState('hello');
  const [replaceNew, setReplaceNew] = useState('world');
  const [replaceAll, setReplaceAll] = useState(false);

  const [deletePath, setDeletePath] = useState('/dev/note.md');

  const [globPattern, setGlobPattern] = useState('**/*.md');
  const [globCwd, setGlobCwd] = useState('');

  const run = useCallback(async (fn: (vfs: VfsService) => Promise<string>) => {
    try {
      const vfs = await getVfs();
      const out = await fn(vfs);
      setResult(out);
    } catch (e) {
      setResult(formatVfsError(e));
    }
  }, []);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Button title="Back to home" onPress={onBack} />
      <Text style={styles.resultLabel}>Result</Text>
      <Text style={styles.result} testID="vfs-result">
        {result || '(no output yet)'}
      </Text>

      <Section title="List">
        <LabeledInput label="Directory" value={listDir} onChangeText={setListDir} />
        <Row label="Recursive">
          <Switch value={listRecursive} onValueChange={setListRecursive} />
        </Row>
        <LabeledInput
          label="Depth (optional)"
          value={listDepth}
          onChangeText={setListDepth}
          placeholder="maxDepth when recursive"
        />
        <Button
          title="List"
          onPress={() =>
            run(async vfs => {
              const depth =
                listDepth.trim() === ''
                  ? undefined
                  : Number.parseInt(listDepth, 10);
              const paths = await vfs.list(listDir, {
                recursive: listRecursive,
                maxDepth: listRecursive ? depth : undefined,
              });
              return paths.join('\n') || '(empty)';
            })
          }
        />
      </Section>

      <Section title="Read">
        <LabeledInput label="Path" value={readPath} onChangeText={setReadPath} />
        <Button
          title="Read"
          onPress={() =>
            run(async vfs => {
              const r = await vfs.read(readPath);
              return `version: ${r.version}\n\n${r.content}`;
            })
          }
        />
      </Section>

      <Section title="Write">
        <LabeledInput label="Path" value={writePath} onChangeText={setWritePath} />
        <LabeledInput
          label="Text"
          value={writeText}
          onChangeText={setWriteText}
          multiline
        />
        <Row label="no-version-check">
          <Switch
            value={writeNoVersionCheck}
            onValueChange={setWriteNoVersionCheck}
          />
        </Row>
        <Button
          title="Write"
          onPress={() =>
            run(async vfs => {
              const version = await vfsWrite(
                vfs,
                writePath,
                writeText,
                writeNoVersionCheck,
              );
              return String(version);
            })
          }
        />
      </Section>

      <Section title="Replace">
        <LabeledInput label="Path" value={replacePath} onChangeText={setReplacePath} />
        <LabeledInput label="Old" value={replaceOld} onChangeText={setReplaceOld} />
        <LabeledInput label="New" value={replaceNew} onChangeText={setReplaceNew} />
        <Row label="replace all">
          <Switch value={replaceAll} onValueChange={setReplaceAll} />
        </Row>
        <Button
          title="Replace"
          onPress={() =>
            run(async vfs => {
              const r = await vfs.replace(replacePath, replaceOld, replaceNew, {
                replaceAll,
              });
              return `${r.version}\t${r.replacements}`;
            })
          }
        />
      </Section>

      <Section title="Delete">
        <LabeledInput label="Path" value={deletePath} onChangeText={setDeletePath} />
        <Button
          title="Delete"
          onPress={() =>
            run(async vfs => {
              await vfs.delete(deletePath);
              return 'ok';
            })
          }
        />
      </Section>

      <Section title="Glob">
        <LabeledInput
          label="Pattern"
          value={globPattern}
          onChangeText={setGlobPattern}
        />
        <LabeledInput
          label="cwd (optional)"
          value={globCwd}
          onChangeText={setGlobCwd}
        />
        <Button
          title="Glob"
          onPress={() =>
            run(async vfs => {
              const cwd = globCwd.trim() === '' ? undefined : globCwd;
              const paths = await vfs.glob(globPattern, {cwd});
              return paths.join('\n') || '(empty)';
            })
          }
        />
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholder={placeholder}
      />
    </View>
  );
}

function Row({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {flex: 1},
  content: {padding: 16, paddingBottom: 48},
  resultLabel: {fontWeight: '600', marginTop: 12, marginBottom: 4},
  result: {
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 16,
    backgroundColor: '#f0f0f0',
    padding: 8,
  },
  section: {
    marginBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#ccc',
    paddingTop: 12,
  },
  sectionTitle: {fontSize: 16, fontWeight: '600', marginBottom: 8},
  field: {marginBottom: 8},
  label: {fontSize: 12, marginBottom: 4},
  input: {
    borderWidth: 1,
    borderColor: '#999',
    padding: 8,
    fontSize: 14,
  },
  inputMultiline: {minHeight: 64, textAlignVertical: 'top'},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
});
