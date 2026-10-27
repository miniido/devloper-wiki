import type { PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

interface WikiEditorProps {
  initialContent?: PartialBlock[];
  editable: boolean;
  onSave?: (content: unknown[]) => Promise<void>;
  saving?: boolean;
}

export default function WikiEditor({
  initialContent,
  editable,
  onSave,
  saving = false,
}: WikiEditorProps) {
  const editor = useCreateBlockNote({
    initialContent: initialContent?.length ? initialContent : undefined,
  });

  return (
    <div className="wiki-editor">
      <BlockNoteView editor={editor} editable={editable} theme="light" />

      {editable && onSave && (
        <div className="editor-actions">
          <button
            className="primary-button"
            disabled={saving}
            onClick={() => onSave(editor.document)}
          >
            {saving ? "저장 중..." : "문서 저장"}
          </button>
        </div>
      )}
    </div>
  );
}
