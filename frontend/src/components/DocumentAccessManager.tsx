import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";
import Icon from "./Icon";
import { roleLabel } from "../roleLabels";
import "./MenuAccessEditor.css";
import "./DocumentAccessManager.css";

interface GroupAccess {
  group_id: number;
  group_name: string;
  can_view: boolean;
  can_edit: boolean;
}
interface AccessData {
  document_id: number | null;
  title: string;
  use_custom_permissions: boolean;
  groups: GroupAccess[];
}
export interface DocumentAccessDraft {
  use_custom_permissions: boolean;
  access_groups: { group_id: number; can_view: boolean; can_edit: boolean }[];
}
export interface DocumentAccessManagerHandle {
  confirmLeave: () => boolean;
  isReady: () => boolean;
  isDirty: () => boolean;
  getDraft: () => DocumentAccessDraft | null;
}
interface Props {
  documentId?: number;
  menuId?: number;
  deferred?: boolean;
  disabled?: boolean;
  onReadyChange?: (ready: boolean) => void;
  onModeChange?: (custom: boolean) => void;
  navigationRef: Ref<DocumentAccessManagerHandle>;
  onSavingChange: (saving: boolean) => void;
  onSaved: () => Promise<void>;
  onClose: () => void;
}

function csrfToken() {
  const cookie = document.cookie.split("; ").find((item) => item.startsWith("csrftoken="));
  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : "";
}

export default function DocumentAccessManager({ documentId, menuId, deferred = false, disabled = false, onReadyChange, onModeChange, navigationRef, onSavingChange, onSaved, onClose }: Props) {
  const [data, setData] = useState<AccessData | null>(null);
  const [saved, setSaved] = useState<AccessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const savingRef = useRef(false);
  const dirty = data !== null && JSON.stringify(data) !== JSON.stringify(saved);

  function confirmLeave() {
    return !savingRef.current && (!dirty || window.confirm("저장하지 않은 문서 권한 변경사항이 있습니다. 변경사항을 버리고 이동할까요?"));
  }
  useImperativeHandle(navigationRef, () => ({
    confirmLeave,
    isReady: () => !loading && data !== null && data.document_id === (documentId ?? null),
    isDirty: () => dirty,
    getDraft: () => data ? ({ use_custom_permissions: data.use_custom_permissions, access_groups: data.groups.map(({ group_id, can_view, can_edit }) => ({ group_id, can_view, can_edit })) }) : null,
  }));
  useEffect(() => {
    onReadyChange?.(!loading && data !== null && data.document_id === (documentId ?? null));
    if (data) onModeChange?.(data.use_custom_permissions);
  }, [data, loading, documentId, onReadyChange, onModeChange]);
  useEffect(() => () => onSavingChange(false), [onSavingChange]);
  useEffect(() => {
    if (!dirty && !saving) return;
    function guard(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ""; }
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, saving]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setData(null);
      setSaved(null);
      setError("");
      setNotice("");
      try {
        const url = documentId === undefined ? `/api/documents/access-options/?menu=${menuId}` : `/api/documents/${documentId}/access/`;
        const response = await fetch(url, { credentials: "same-origin", signal: controller.signal });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.detail || `권한 조회 실패 (${response.status})`);
        if (!controller.signal.aborted) { setData(result); setSaved(result); }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "권한 조회 실패");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [documentId, menuId, reload]);

  function changePermission(id: number, field: "can_view" | "can_edit", value: boolean) {
    setData((previous) => previous && ({ ...previous, groups: previous.groups.map((group) => {
      if (group.group_id !== id) return group;
      if (field === "can_edit" && value) return { ...group, can_view: true, can_edit: true };
      if (field === "can_view" && !value) return { ...group, can_view: false, can_edit: false };
      return { ...group, [field]: value };
    }) }));
    setNotice("");
  }

  async function save() {
    if (deferred || !data || !dirty || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    onSavingChange(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetch("/api/csrf/", { credentials: "same-origin" });
      if (!csrf.ok) throw new Error("보안 토큰 발급에 실패했습니다.");
      const response = await fetch(`/api/documents/${documentId}/access/`, {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
        body: JSON.stringify({ use_custom_permissions: data.use_custom_permissions, groups: data.groups.map(({ group_id, can_view, can_edit }) => ({ group_id, can_view, can_edit })) }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.detail || `권한 저장 실패 (${response.status})`);
      setData(result);
      setSaved(result);
      setNotice("문서 접근 권한이 저장되었습니다.");
      try { await onSaved(); }
      catch { setNotice("권한은 저장되었지만 화면 갱신에 실패했습니다. 새로고침해 주세요."); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "권한 저장 실패");
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  return <section className="document-access-manager" id={`document-access-${documentId}`} aria-label="문서 접근 권한">
    <div className="document-access-heading">
      <div className="section-title-group"><span className="section-icon"><Icon name="shield" /></span><div className="section-heading-copy"><h2>접근 권한</h2><p>이 문서의 열람과 수정 범위를 설정합니다.</p></div></div>
      <button className="text-button" disabled={saving || disabled} onClick={() => { if (deferred || confirmLeave()) onClose(); }}><Icon name="close" />닫기</button>
    </div>
    {error && <p className="menu-access-error" role="alert">{error}</p>}
    {notice && <p className="menu-access-notice" role="status">{notice}</p>}
    {loading ? <p className="menu-access-muted" role="status">문서 권한을 불러오는 중...</p> : data && data.document_id === (documentId ?? null) ? <>
      <fieldset className="document-access-mode" disabled={saving || disabled}>
        <legend>권한 모드</legend>
        <label><input type="radio" name={`access-mode-${documentId}`} checked={!data.use_custom_permissions} onChange={() => { setData({ ...data, use_custom_permissions: false }); setNotice(""); }} /><span><strong>메뉴 권한 사용</strong><small>소속 메뉴의 권한 정책을 따릅니다.</small></span></label>
        <label><input type="radio" name={`access-mode-${documentId}`} checked={data.use_custom_permissions} onChange={() => { setData({ ...data, use_custom_permissions: true }); setNotice(""); }} /><span><strong>문서별 권한 설정 (CUSTOM)</strong><small>메뉴 권한에 그룹별 문서 권한을 추가로 적용합니다.</small></span></label>
      </fieldset>
      {data.use_custom_permissions && <div className="menu-access-table-wrap"><table className="menu-access-table">
        <caption className="sr-only">문서별 그룹 조회·수정 권한</caption>
        <thead><tr><th scope="col">그룹</th><th scope="col">조회</th><th scope="col">수정</th></tr></thead>
        <tbody>{data.groups.map((group) => <tr key={group.group_id}><th scope="row"><span className="menu-access-role">{roleLabel(group.group_name)}</span><small className="menu-access-code">{group.group_name}</small></th>{(["can_view", "can_edit"] as const).map((field) => <td key={field}><input type="checkbox" checked={group[field]} disabled={saving || disabled} aria-label={`${group.group_name} ${field === "can_view" ? "조회" : "수정"} 권한`} onChange={(event) => changePermission(group.group_id, field, event.target.checked)} /></td>)}</tr>)}{data.groups.length === 0 && <tr><td colSpan={3} className="menu-access-empty">설정할 그룹이 없습니다.</td></tr>}</tbody>
      </table></div>}
      <p className="menu-access-hint">문서 권한은 메뉴 권한과 전역 문서 권한을 넘어서 적용되지 않습니다. 메뉴 권한 사용으로 전환해도 그룹별 설정은 보관되며 CUSTOM을 다시 켜면 재사용됩니다.</p>
      {data.use_custom_permissions && <p className="menu-access-hint">관리자 본인의 조회·수정 권한도 제한될 수 있습니다. 관리 권한을 잃으면 Superuser에게 복구를 요청해야 합니다.</p>}
      <div className="menu-access-actions">{dirty && <span className="menu-access-muted">저장하지 않은 변경사항이 있습니다.</span>}{deferred ? <span className="menu-access-muted">권한 변경은 상단의 문서 저장 버튼으로 본문과 함께 저장됩니다.</span> : <button className="primary-button" disabled={saving || !dirty} onClick={() => void save()}><Icon name="save" />{saving ? "저장 중..." : "문서 권한 저장"}</button>}</div>
    </> : <button className="secondary-button document-access-retry" onClick={() => setReload((value) => value + 1)}>다시 불러오기</button>}
  </section>;
}
