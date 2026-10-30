import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

export interface MenuAccessEditorHandle {
  confirmLeave: () => boolean;
}
import "./MenuAccessEditor.css";
import Icon from "./Icon";
import { roleLabel } from "../roleLabels";

interface GroupAccess {
  group_id: number;
  group_name: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
}

interface MenuAccessResponse {
  menu_id: number;
  menu_name: string;
  is_public: boolean;
  groups: GroupAccess[];
}

interface Props {
  menuId: number;
  isPublic: boolean;
  onChanged: () => Promise<void>;
  navigationRef: Ref<MenuAccessEditorHandle>;
  onSavingChange: (saving: boolean) => void;
}

type Permission = "can_view" | "can_create" | "can_edit";

function getCsrfToken(): string {
  const cookie = document.cookie
    .split("; ")
    .find((value) => value.startsWith("csrftoken="));

  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : "";
}

export default function MenuAccessEditor({
  menuId,
  isPublic,
  onChanged,
  navigationRef,
  onSavingChange,
}: Props) {
  const [groups, setGroups] = useState<GroupAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedGroups, setSavedGroups] = useState<GroupAccess[]>([]);
  const dirty = JSON.stringify(groups) !== JSON.stringify(savedGroups);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccess() {
      setLoading(true);
      setGroups([]);
      setSavedGroups([]);
      setError("");
      setNotice("");

      try {
        const response = await fetch(`/api/menu-management/${menuId}/access/`, {
          credentials: "same-origin",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `권한 정보를 불러오지 못했습니다. (${response.status})`,
          );
        }

        const result = (await response.json()) as MenuAccessResponse;

        if (!controller.signal.aborted) {
          setGroups(result.groups);
          setSavedGroups(result.groups);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "권한 조회 실패");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadAccess();

    return () => controller.abort();
  }, [menuId]);

  useImperativeHandle(navigationRef, () => ({
    confirmLeave: () => !savingRef.current && (!dirty || window.confirm("저장하지 않은 접근 권한 변경사항이 있습니다. 변경사항을 버리고 이동할까요?")),
  }));

  useEffect(() => () => onSavingChange(false), [onSavingChange]);

  useEffect(() => {
    if (!dirty && !saving) return;
    function preventUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty, saving]);

  function changePermission(
    groupId: number,
    field: Permission,
    checked: boolean,
  ) {
    setGroups((current) =>
      current.map((group) => {
        if (group.group_id !== groupId) return group;

        if (field === "can_view" && !checked) {
          return {
            ...group,
            can_view: false,
            can_create: false,
            can_edit: false,
          };
        }

        if ((field === "can_create" || field === "can_edit") && checked) {
          return {
            ...group,
            can_view: true,
            [field]: true,
          };
        }

        return {
          ...group,
          [field]: checked,
        };
      }),
    );

    setNotice("");
  }

  async function saveAccess() {
    if (savingRef.current || loading || !dirty) return;
    savingRef.current = true;

    setSaving(true);
    onSavingChange(true);
    setError("");
    setNotice("");

    try {
      const csrfResponse = await fetch("/api/csrf/", {
        credentials: "same-origin",
      });

      if (!csrfResponse.ok) {
        throw new Error("보안 토큰 발급에 실패했습니다.");
      }

      const response = await fetch(`/api/menu-management/${menuId}/access/`, {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken(),
        },
        body: JSON.stringify({
          groups: groups.map((group) => ({
            group_id: group.group_id,
            can_view: group.can_view,
            can_create: group.can_create,
            can_edit: group.can_edit,
          })),
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(result?.detail ?? `저장 실패 (${response.status})`);
      }

      setGroups((result as MenuAccessResponse).groups);
      setSavedGroups((result as MenuAccessResponse).groups);
      setNotice("접근 권한이 저장되었습니다.");

      // App.tsx의 메뉴/문서 목록 갱신
      try {
        await onChanged();
      } catch {
        setNotice("권한은 저장되었지만 메뉴 목록 새로고침에 실패했습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "권한 저장 실패");
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <section className="menu-access-editor">
      <div className="menu-access-heading section-title-group">
        <span className="section-icon"><Icon name="shield" /></span>
        <div className="section-heading-copy">
          <h3>그룹별 접근 권한</h3>
          <p>선택한 메뉴의 문서 조회·작성·수정 권한을 설정합니다.</p>
        </div>
      </div>

      {isPublic && (
        <p className="menu-access-info"><Icon name="users" />
          공개 메뉴는 로그인한 모든 사용자가 조회할 수 있습니다. 그룹별 조회 제한을
          적용하려면 비공개 메뉴로 변경하세요. 공개 여부는 메뉴 정보를 저장한 뒤 반영됩니다.
        </p>
      )}

      {error && (
        <p className="menu-access-error" role="alert">
          {error}
        </p>
      )}

      {notice && (
        <p className="menu-access-notice" role="status">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="menu-access-muted">권한 정보를 불러오는 중...</p>
      ) : (
        <>
          <div className="menu-access-table-wrap">
            <table className="menu-access-table">
              <caption className="sr-only">역할 그룹별 문서 조회, 작성, 수정 권한</caption>
              <thead>
                <tr>
                  <th scope="col">그룹</th>
                  <th scope="col">조회</th>
                  <th scope="col">작성</th>
                  <th scope="col">수정</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.group_id}>
                    <th scope="row"><span className="menu-access-role">{roleLabel(group.group_name)}</span><small className="menu-access-code">{group.group_name}</small></th>
                    {(["can_view", "can_create", "can_edit"] as const).map(
                      (field) => (
                        <td key={field}>
                          <input
                            type="checkbox"
                            aria-label={`${group.group_name} ${
                              field === "can_view"
                                ? "조회"
                                : field === "can_create"
                                  ? "작성"
                                  : "수정"
                            } 권한`}
                            checked={group[field]}
                            disabled={saving}
                            onChange={(event) =>
                              changePermission(
                                group.group_id,
                                field,
                                event.target.checked,
                              )
                            }
                          />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
                {groups.length === 0 && <tr><td colSpan={4} className="menu-access-empty">설정할 수 있는 그룹이 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>

          <p className="menu-access-hint">
            조회 권한을 해제하면 작성·수정 권한도 함께 해제됩니다.
            실제 문서 작업에는 Django 전역 모델 권한도 필요하며, 문서별 추가 권한 제한이 적용될 수 있습니다.
            이 설정은 선택한 메뉴에만 적용되며 하위 메뉴로 자동 상속되지 않습니다.
          </p>

          <div className="menu-access-actions">
            {dirty && (
              <span className="menu-access-muted">
                저장하지 않은 변경사항이 있습니다.
              </span>
            )}
            <button
              type="button"
              className="primary-button"
              disabled={saving || !dirty || groups.length === 0}
              onClick={() => void saveAccess()}
            >
              <Icon name="save" />{saving ? "저장 중..." : "권한 저장"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
