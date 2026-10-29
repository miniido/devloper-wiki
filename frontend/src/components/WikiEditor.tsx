import { useImperativeHandle } from "react";
import type { Ref } from "react";

export interface WikiEditorHandle {
  getContent: () => unknown[];
}
import type { PartialBlock } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

interface WikiEditorProps {
  documentId?: number;
  initialContent?: PartialBlock[];
  editable: boolean;
  editorRef?: Ref<WikiEditorHandle>;
}

function getCsrfToken() {
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith("csrftoken="));

  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : "";
}

export default function WikiEditor({
  documentId,
  initialContent,
  editable,
  editorRef,
}: WikiEditorProps) {
  const editor = useCreateBlockNote({
    initialContent: initialContent?.length ? initialContent : undefined,

    uploadFile: async (file: File) => {
      if (!editable || !documentId) {
        throw new Error("이미지를 추가하려면 문서를 먼저 저장해 주세요.");
      }

      const isImage = ["image/png", "image/jpeg", "image/webp"].includes(
        file.type,
      );

      if (!isImage) {
        throw new Error("PNG, JPG, WEBP 이미지만 업로드할 수 있습니다.");
      }

      if (file.size > 5 * 1024 * 1024) {
        throw new Error("이미지는 최대 5MB까지 업로드할 수 있습니다.");
      }

      const csrfResponse = await fetch("/api/csrf/", {
        credentials: "same-origin",
      });

      if (!csrfResponse.ok) {
        throw new Error("보안 토큰 발급에 실패했습니다.");
      }

      const formData = new FormData();

      formData.append("file", file);
      formData.append("purpose", "INLINE");

      const response = await fetch(
        `/api/documents/${documentId}/attachments/`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "X-CSRFToken": getCsrfToken(),
          },
          body: formData,
        },
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || "이미지 업로드에 실패했습니다.");
      }

      const result: { id: number } = await response.json();

      return `/api/attachments/${result.id}/preview/`;
    },
  });

  useImperativeHandle(editorRef, () => ({ getContent: () => editor.document }), [editor]);

  return (
    <div className="wiki-editor">
      <BlockNoteView editor={editor} editable={editable} theme="light" />
    </div>
  );
}
