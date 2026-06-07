import CodeMirror from "@uiw/react-codemirror";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
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
  onChange: (value: string) => void;
  onSave?: () => void;
  "aria-label"?: string;
};

export function CodeEditor({
  id,
  value,
  languagePath,
  onChange,
  onSave,
  "aria-label": ariaLabel,
}: CodeEditorProps) {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const extensions = useMemo(() => {
    return [
      novelEditorTheme,
      novelSyntaxHighlighting,
      EditorView.lineWrapping,
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
        ...historyKeymap,
      ]),
    ];
  }, [languagePath]);

  return (
    <div className="code-editor">
      <CodeMirror
        id={id}
        className="code-editor__mirror"
        value={value}
        height="100%"
        theme="none"
        extensions={extensions}
        onChange={onChange}
        aria-label={ariaLabel}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          defaultKeymap: false,
          history: true,
          drawSelection: true,
          indentOnInput: true,
          syntaxHighlighting: false,
        }}
      />
    </div>
  );
}
