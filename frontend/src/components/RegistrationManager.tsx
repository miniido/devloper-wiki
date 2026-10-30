import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import "./RegistrationManager.css";

type RequestStatus = "PENDING" | "APPROVED" | "REJECTED";
interface Registration {
  id: number; username: string; first_name: string; last_name: string; reason: string;
  status: RequestStatus; requested_at: string; reviewed_at: string | null; reviewed_by: string | null;
}
interface Page { count: number; next: string | null; previous: string | null; results: Registration[]; }
const STATUS_LABELS: Record<RequestStatus, string> = { PENDING: "승인 대기", APPROVED: "승인 완료", REJECTED: "거절" };
function csrfToken() { return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? ""); }

export default function RegistrationManager({ onApproved, onBusyChange }: { onApproved: () => Promise<unknown>; onBusyChange: (busy: boolean) => void }) {
  const [filter, setFilter] = useState("PENDING");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Page | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const busyRef = useRef(false);
  const selected = data?.results.find((item) => item.id === selectedId);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/registration-management/?status=${filter}&page=${page}`, { credentials: "same-origin", signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.detail || `신청 목록 조회 실패 (${response.status})`);
        if (!controller.signal.aborted) setData(result);
      } catch (err) {
        if (!controller.signal.aborted) { setData(null); setError(err instanceof Error ? err.message : "신청 목록 조회 실패"); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [filter, page, reload]);

  async function review(action: "approve" | "reject") {
    if (!selected || busyRef.current || selected.status !== "PENDING") return;
    const message = action === "approve"
      ? `"${selected.username}"님의 가입을 승인할까요?\n열람자(VIEWER) 계정이 생성됩니다.`
      : `"${selected.username}"님의 가입 신청을 거절할까요?\n신청자는 이후 다시 신청할 수 있습니다.`;
    if (!window.confirm(message)) return;
    busyRef.current = true;
    setBusy(true); onBusyChange(true); setError(""); setNotice("");
    try {
      const csrf = await fetch("/api/csrf/", { credentials: "same-origin" });
      if (!csrf.ok) throw new Error("보안 토큰 발급에 실패했습니다.");
      const response = await fetch(`/api/registration-management/${selected.id}/${action}/`, {
        method: "POST", credentials: "same-origin", headers: { "X-CSRFToken": csrfToken(), "Content-Type": "application/json" }, body: "{}",
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) { setSelectedId(null); setPage(1); setReload((value) => value + 1); }
        throw new Error(result?.detail || `신청 처리 실패 (${response.status})`);
      }
      setSelectedId(null); setPage(1); setReload((value) => value + 1);
      setNotice(action === "approve" ? "가입을 승인하고 열람자 계정을 생성했습니다." : "가입 신청을 거절했습니다.");
      if (action === "approve") {
        try { await onApproved(); }
        catch { setNotice("가입 승인은 완료되었지만 사용자 목록 갱신에 실패했습니다. 전체 사용자 탭에서 다시 확인해 주세요."); }
      }
    } catch (err) { setError(err instanceof Error ? err.message : "신청 처리 실패"); }
    finally { busyRef.current = false; setBusy(false); onBusyChange(false); }
  }

  return <section className="registration-manager" aria-label="가입 신청 관리">
    <div className="registration-list-toolbar"><p>신청 내용을 확인한 뒤 승인 또는 거절해 주세요.</p><div className="registration-filter-control"><label htmlFor="registration-filter">상태</label><select id="registration-filter" value={filter} disabled={busy} onChange={(event) => { setFilter(event.target.value); setPage(1); setSelectedId(null); setError(""); setNotice(""); }}><option value="PENDING">승인 대기</option><option value="APPROVED">승인 완료</option><option value="REJECTED">거절</option><option value="ALL">전체</option></select></div></div>
    {error && <p className="um-error" role="alert">{error}</p>}
    {notice && <p className="um-notice" role="status">{notice}</p>}
    {loading ? <p className="um-muted" role="status">가입 신청을 불러오는 중...</p> : !data ? <button className="secondary-button" onClick={() => { setError(""); setReload((value) => value + 1); }}>다시 불러오기</button> : <div className="um-layout">
      <div className="um-list-panel"><div className="um-count">가입 신청 {data.count}건</div>
        {data.results.length === 0 ? <p className="registration-empty">{filter === "PENDING" ? "승인을 기다리는 신청이 없습니다." : "해당 상태의 신청이 없습니다."}</p> : data.results.map((item) => <button key={item.id} className={`um-user registration-list-item ${selectedId === item.id ? "selected" : ""}`} aria-pressed={selectedId === item.id} disabled={busy} onClick={() => { setSelectedId(item.id); setError(""); }}><span className="um-user-info"><strong>{item.username}</strong><small>{item.last_name}{item.first_name} · {new Date(item.requested_at).toLocaleDateString("ko-KR")}</small></span><span className={`registration-status ${item.status.toLowerCase()}`}>{STATUS_LABELS[item.status]}</span></button>)}
        {(data.next || data.previous) && <nav className="registration-pagination" aria-label="가입 신청 페이지"><button className="text-button" disabled={busy || !data.previous} onClick={() => { setPage(page - 1); setSelectedId(null); }}>이전</button><span>{page} 페이지</span><button className="text-button" disabled={busy || !data.next} onClick={() => { setPage(page + 1); setSelectedId(null); }}>다음</button></nav>}
      </div>
      <div className="um-detail">{!selected ? <div className="um-placeholder"><span className="um-placeholder-icon"><Icon name="users" /></span><strong>가입 신청을 선택해 주세요.</strong><p>승인하면 기본 역할이 열람자인 계정이 생성됩니다.</p></div> : <article className="registration-detail">
        <div className="um-detail-header"><h2>{selected.username}</h2><span className={`registration-status ${selected.status.toLowerCase()}`}>{STATUS_LABELS[selected.status]}</span></div>
        <dl><div><dt>이름</dt><dd>{selected.last_name}{selected.first_name}</dd></div><div><dt>신청 일시</dt><dd>{new Date(selected.requested_at).toLocaleString("ko-KR")}</dd></div></dl>
        <div className="registration-reason"><h3>신청 사유</h3><p>{selected.reason || "입력한 신청 사유가 없습니다."}</p></div>
        {selected.reviewed_at && <p className="registration-reviewed">{new Date(selected.reviewed_at).toLocaleString("ko-KR")} · {selected.reviewed_by || "관리자"} 처리</p>}
        {selected.status === "PENDING" && <><p className="registration-review-help">승인 후 열람자(VIEWER) 역할이 부여됩니다. 작성 권한은 전체 사용자 탭에서 별도로 설정하세요.</p><div className="registration-review-actions"><button className="secondary-button registration-reject" disabled={busy} onClick={() => void review("reject")}><Icon name="close" />거절</button><button className="primary-button" disabled={busy} onClick={() => void review("approve")}><Icon name="shield" />{busy ? "처리 중..." : "승인"}</button></div></>}
      </article>}</div>
    </div>}
  </section>;
}
