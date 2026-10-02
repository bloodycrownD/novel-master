import CodeMirror from "@uiw/react-codemirror";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useMemo, useRef } from "react";
import {
  novelEditorTheme,
  novelSyntaxHighlighting,
} from "./codemirror-theme";
import { languageExtensionForPath } from "./language-for-path";

type CodeEditorProps = {
  id?: string;
  value: string;
  languagePath: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  "aria-label"?: string;
  /**
   * 只读预览态（prompt-rounds 的 assistant 轮详情用）。
   *
   * 语义：内容不可编辑（`EditorState.readOnly` + `EditorView.editable`）、
   * 历史/自动补括号等写入型能力关掉，但**保留 selection 供复制**。
   */
  readOnly?: boolean;
};

export function CodeEditor({
  id,
  value,
  languagePath,
  onChange,
  onSave,
  "aria-label": ariaLabel,
  readOnly = false,
}: CodeEditorProps) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const extensions = useMemo(() => {
    return [
      novelEditorTheme,
      novelSyntaxHighlighting,
      EditorView.lineWrapping,
      ...(readOnly
        ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
        : []),
      ...languageExtensionForPath(languagePath),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            saveRef.current?.();
            return true;
          },
        },
        ...defaultKeymap,
        // 只读态不给撤销/重做 history keymap（无历史可撤）。
        ...(readOnly ? [] : historyKeymap),
      ]),
    ];
  }, [languagePath, readOnly]);

  return (
    <div className="code-editor">
      <CodeMirror
        id={id}
        className="code-editor__mirror"
        value={value}
        height="100%"
        theme="none"
        extensions={extensions}
        // 只读态不挂 onChange：内容永不回写，也就没有「用户改了正文」的路径。
        onChange={readOnly ? undefined : onChange}
        aria-label={ariaLabel}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLineGutter: true,
          highlightActiveLine: !readOnly,
          bracketMatching: true,
          closeBrackets: !readOnly,
          autocompletion: false,
          defaultKeymap: false,
          history: !readOnly,
          drawSelection: true,
          indentOnInput: !readOnly,
          syntaxHighlighting: false,
        }}
      />
    </div>
  );
}
