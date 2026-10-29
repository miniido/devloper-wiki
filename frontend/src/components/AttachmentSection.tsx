import { useEffect,useRef,useState } from "react";

import Icon from "./Icon";

interface Attachment {
  id: number;
  name: string;
  size: number;
  uploaded_at: string;
  download_url: string;
}

interface Props {
  documentId: number;
  canEdit: boolean;
  editMode: boolean;
}

function getCsrfToken() {
  const cookie=document.cookie
    .split("; ")
    .find((item) => item.startsWith("csrftoken="));

  return cookie? decodeURIComponent(cookie.slice("csrftoken=".length)):"";
}

function formatSize(bytes: number) {
  if(bytes<1024) return `${bytes} B`;
  if(bytes<1024*1024) {
    return `${(bytes/1024).toFixed(1)} KB`;
  }
  return `${(bytes/(1024*1024)).toFixed(1)} MB`;
}

export default function AttachmentSection({
  documentId,
  canEdit,
  editMode,
}: Props) {
  const [loading,setLoading]=useState(true);
  const [items,setItems]=useState<Attachment[]>([]);
  const [uploading,setUploading]=useState(false);
  const [error,setError]=useState("");
  const inputRef=useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller=new AbortController();

    fetch(`/api/documents/${documentId}/attachments/`,{
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => {
        if(!response.ok) {
          throw new Error("첨부파일 조회 실패");
        }
        return response.json() as Promise<Attachment[]>;
      })
      .then((data) => { if(!controller.signal.aborted) setItems(data); })
      .catch((err) => {
        if(!controller.signal.aborted) {
          setError(err.message);
        }
      })
      .finally(() => { if(!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();
  },[documentId]);

  async function uploadFile(file: File) {
    setUploading(true);
    setError("");

    try {
      await fetch("/api/csrf/",{
        credentials: "same-origin",
      });

      const formData=new FormData();
      formData.append("file",file);

      const response=await fetch(
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

      if(!response.ok) {
        const result=await response.json();
        throw new Error(result.detail||"업로드에 실패했습니다.");
      }

      const uploaded: Attachment=await response.json();

      setItems((prev) => [uploaded,...prev]);
    } catch(err) {
      setError(err instanceof Error? err.message:"업로드 오류");
    } finally {
      setUploading(false);
      if(inputRef.current) inputRef.current.value="";
    }
  }

  async function deleteFile(item: Attachment) {
    if(!window.confirm(`"${item.name}" 파일을 삭제할까요?`)) {
      return;
    }

    setError("");

    try {
      const csrfResponse=await fetch("/api/csrf/",{
        credentials: "same-origin",
      });

      if(!csrfResponse.ok) {
        throw new Error("보안 토큰을 가져오지 못했습니다.");
      }

      const response=await fetch(`/api/attachments/${item.id}/`,{
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "X-CSRFToken": getCsrfToken(),
        },
      });

      if(!response.ok) {
        throw new Error(`파일 삭제 실패 (${response.status})`);
      }

      setItems((prev) => prev.filter((file) => file.id!==item.id));
    } catch(err) {
      setError(err instanceof Error? err.message:"파일 삭제 오류");
    }
  }

  return (
    <section className="attachment-section">
      <div className="attachment-heading">
        <div className="section-title-group">
          <span className="section-icon"><Icon name="paperclip" /></span>
          <div className="section-heading-copy">
            <h3>첨부파일 <span>{items.length}</span></h3>
            <p>문서에 연결된 파일을 다운로드하세요.</p>
          </div>
        </div>

        {canEdit&&editMode&&(
          <>
            <input
              ref={inputRef}
              type="file"
              hidden
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.sql,.json,.xml,.yaml,.yml,.png,.jpg,.jpeg,.webp,.zip"
              onChange={(e) => {
                const file=e.target.files?.[0];
                if(file) void uploadFile(file);
              }}
            />

            <button
              className="attachment-add"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading? "업로드 중...":"+ 파일 추가"}
            </button>
          </>
        )}
      </div>

      {error&&<p className="attachment-error">{error}</p>}

      {loading? <p className="attachment-empty" role="status">첨부파일을 불러오는 중…</p>:items.length===0? (
        <p className="attachment-empty">첨부파일이 없습니다.</p>
      ):(
        <div className="attachment-list">
          {items.map((item) => (
            <div key={item.id} className="attachment-item">
              <Icon name={/\.(png|jpe?g|webp)$/i.test(item.name)? "image":/\.(zip)$/i.test(item.name)? "archive":/\.(sql|json|xml|ya?ml)$/i.test(item.name)? "code":"file"} />
              <a href={item.download_url} className="attachment-filename">
                {item.name}
              </a>

              <span className="attachment-size">{formatSize(item.size)}</span>

              <a href={item.download_url} aria-label={`${item.name} 다운로드`}>
                <Icon name="download" />
              </a>

              {canEdit&&editMode&&(
                <button
                  type="button"
                  className="attachment-delete"
                  onClick={() => void deleteFile(item)}
                >
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
