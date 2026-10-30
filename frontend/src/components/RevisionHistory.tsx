import { useEffect,useRef,useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import WikiEditor from "./WikiEditor";
import Icon from "./Icon";

interface Revision {
  id: number;
  can_delete?: boolean;
  version: number;
  title: string;
  menu: number;
  content?: PartialBlock[];
  changed_by: string|null;
  created_at: string;
}

interface Props {
  documentId: number;
  currentVersion: number;
  canEdit: boolean;
  canDelete?: boolean;
  onRestored: () => Promise<void>;
}

async function fetchRevisions(documentId: number, signal?: AbortSignal): Promise<Revision[]> {
  const response = await fetch(`/api/documents/${documentId}/revisions/`, { credentials: "same-origin", signal });
  if (!response.ok) throw new Error(`수정 이력 조회 실패 (${response.status})`);
  const data: Revision[] = await response.json();
  return data.sort((a, b) => b.version - a.version);
}

export default function RevisionHistory({
  documentId,
  currentVersion,
  canEdit,
  canDelete = false,
  onRestored,
}: Props) {
  const mutationRef = useRef(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [expanded,setExpanded]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [revisions,setRevisions]=useState<Revision[]>([]);
  const [selected,setSelected]=useState<Revision|null>(null);
  const [loadingVersion,setLoadingVersion]=useState<number|null>(null);
  const [restoring,setRestoring]=useState(false);
  const [error,setError]=useState("");

  useEffect(() => {
    if(!expanded) return;
    const controller=new AbortController();

    fetchRevisions(documentId, controller.signal)
      .then((data) => {
        if(!controller.signal.aborted) {
          setRevisions([...data].sort((a,b) => b.version-a.version));
          setLoaded(true);
        }
      })
      .catch((err: Error) => {
        if(!controller.signal.aborted) setError(err.message);
      });

    return () => controller.abort();
  },[documentId,currentVersion,expanded]);

  async function openRevision(version: number) {
    if (mutationRef.current || loadingVersion !== null) return;
    setLoadingVersion(version);
    setError("");

    try {
      const response=await fetch(
        `/api/documents/${documentId}/revisions/${version}/`,
        { credentials: "same-origin" },
      );

      if(!response.ok) {
        throw new Error(`이전 버전 조회 실패 (${response.status})`);
      }

      const revision: Revision=await response.json();

      setSelected(revision);
    } catch(err) {
      setError(err instanceof Error? err.message:"이전 버전 조회 오류");
    } finally {
      setLoadingVersion(null);
    }
  }

  async function restoreRevision() {
    if(!selected||mutationRef.current||loadingVersion !== null||!canEdit) return;

    if(
      !window.confirm(
        `v${selected.version}으로 복구할까요?\n현재 버전은 이력으로 유지됩니다.`,
      )
    )
      return;

    mutationRef.current = true;
    setRestoring(true);
    setNotice("");
    setError("");

    try {
      const csrfResponse=await fetch("/api/csrf/",{
        credentials: "same-origin",
      });

      if(!csrfResponse.ok) {
        throw new Error("CSRF 요청 실패");
      }

      const token=document.cookie
        .split("; ")
        .find((item) => item.startsWith("csrftoken="))
        ?.slice("csrftoken=".length);

      const response=await fetch(
        `/api/documents/${documentId}/revisions/${selected.version}/restore/`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": decodeURIComponent(token??""),
          },
          body: JSON.stringify({ version: currentVersion }),
        },
      );

      if(!response.ok) {
        const result=await response.json().catch(() => ({}));
        throw new Error(result.detail||"복구 실패");
      }

      await onRestored();
      setSelected(null);
    } catch(err) {
      setError(err instanceof Error? err.message:"복구 오류");
    } finally {
      mutationRef.current = false;
      setRestoring(false);
    }
  }

  async function deleteRevision(revision: Revision) {
    if (!canDelete || mutationRef.current || loadingVersion !== null || revision.version >= currentVersion || revisions.length <= 1) return;
    if (!window.confirm(`v${revision.version} 수정 이력을 삭제할까요?\n삭제한 이력은 복구할 수 없습니다. 현재 문서 내용은 유지됩니다.`)) return;
    mutationRef.current = true;
    setDeletingId(revision.id);
    setError("");
    setNotice("");
    try {
      const csrf = await fetch("/api/csrf/", { credentials: "same-origin" });
      if (!csrf.ok) throw new Error("보안 토큰 발급에 실패했습니다.");
      const token = document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice("csrftoken=".length);
      const response = await fetch(`/api/documents/${documentId}/revisions/by-id/${revision.id}/`, {
        method: "DELETE", credentials: "same-origin", headers: { "X-CSRFToken": decodeURIComponent(token ?? "") },
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || `이력 삭제 실패 (${response.status})`);
      }
      setRevisions((previous) => previous.filter((item) => item.id !== revision.id));
      if (selected?.id === revision.id) setSelected(null);
      setNotice(`v${revision.version} 수정 이력이 삭제되었습니다.`);
      try { setRevisions(await fetchRevisions(documentId)); }
      catch { setError("이력은 삭제되었지만 목록 갱신에 실패했습니다. 이력을 다시 열어 주세요."); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "이력 삭제 실패");
    } finally {
      mutationRef.current = false;
      setDeletingId(null);
    }
  }

  return (
    <section className="revision-history">
      <button className="revision-toggle" aria-expanded={expanded} aria-controls={`revision-panel-${documentId}`} onClick={() => setExpanded(!expanded)}>
        <span className="section-title-group">
          <span className="section-icon"><Icon name="history" /></span>
          <span className="section-heading-copy">
            <strong>수정 이력</strong>
            <small>{canEdit ? "이전 버전을 확인하고 복구할 수 있습니다." : "이전 버전의 내용을 확인하세요."}</small>
          </span>
        </span>
        <span className="revision-toggle-status"><span className="version-badge">v{currentVersion}</span><Icon name="chevron" className={expanded ? "chevron expanded" : "chevron"} /></span>
      </button>
      {expanded&&<div id={`revision-panel-${documentId}`}>
        <div className="revision-heading">
          <h3>수정 이력</h3>
          <span>{revisions.length}개 버전</span>
        </div>

        {error&&<p className="attachment-error" role="alert">{error}</p>}
        {notice && <p className="revision-notice" role="status">{notice}</p>}

        {!loaded&&!error? <p className="hint" role="status">수정 이력을 불러오는 중…</p>:revisions.length===0? (
          <p className="hint">아직 저장된 수정 이력이 없습니다.</p>
        ):(
          <div className="revision-list">
            {revisions.map((revision) => (
              <div className="revision-row" key={revision.id}><button
                type="button"
                className={`revision-item ${selected?.version===revision.version? "active":""
                  }`}
                disabled={loadingVersion!==null||restoring||deletingId!==null}
                aria-pressed={selected?.version===revision.version}
                onClick={() => void openRevision(revision.version)}
              >
                <div className="revision-item-main">
                  <span className="revision-version">v{revision.version}</span>
                  {revision.version===currentVersion&&(
                    <span className="revision-current">최신</span>
                  )}
                </div>

                <div className="revision-item-meta">
                  {revision.changed_by??"기존 문서"} ·{" "}
                  {new Date(revision.created_at).toLocaleString("ko-KR")}
                </div>

                {loadingVersion===revision.version&&(
                  <span className="revision-loading">불러오는 중...</span>
                )}
              </button>
              {canDelete && revision.can_delete !== false && revision.version < currentVersion && revisions.length > 1 && <button type="button" className="revision-delete" aria-label={`v${revision.version} 이력 삭제`} title="이력 삭제 (복구 불가)" disabled={restoring || deletingId !== null || loadingVersion !== null} onClick={() => void deleteRevision(revision)}><Icon name="trash" />{deletingId === revision.id && <span>삭제 중…</span>}</button>}
              </div>
            ))}
          </div>
        )}

        {selected&&(
          <div className="revision-preview">
            <div className="revision-preview-heading">
              <strong>v{selected.version} 미리보기</strong>
              <span>읽기 전용</span>
            </div>

            <h4>{selected.title}</h4>

            <div className="revision-preview-content">
              <WikiEditor
                key={`${documentId}-${selected.version}`}
                initialContent={selected.content}
                editable={false}
              />
            </div>

            {canEdit&&selected.version!==currentVersion&&(
              <div className="revision-preview-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={restoring || deletingId !== null || loadingVersion !== null}
                  onClick={() => void restoreRevision()}
                >
                  {restoring? "복구 중...":"이 버전으로 복구"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>}
    </section>
  );
}
