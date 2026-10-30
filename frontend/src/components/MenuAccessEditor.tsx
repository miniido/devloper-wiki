import { useEffect, useState } from "react";
import "./MenuAccessEditor.css";

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
}: Props) {
  const [groups, setGroups] = useState<GroupAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadAccess() {
      setLoading(true);
      setGroups([]);
      setDirty(false);
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

    setDirty(true);
    setNotice("");
  }

  async function saveAccess() {
    if (saving || loading || !dirty) return;

    setSaving(true);
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
      setDirty(false);
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
      setSaving(false);
    }
  }

  return (
    <section className="menu-access-editor">
      <div className="menu-access-heading">
        <div>
          <h3>그룹별 접근 권한</h3>
          <p>선택한 메뉴의 문서 조회·작성·수정 권한을 설정합니다.</p>
        </div>
      </div>

      {isPublic && (
        <p className="menu-access-info">
          현재 전체 공개 메뉴입니다. 로그인한 사용자는 그룹 조회 권한과 관계없이
          메뉴를 열람할 수 있습니다.
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
                    <th scope="row">{group.group_name}</th>
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
              </tbody>
            </table>
          </div>

          <p className="menu-access-hint">
            조회 권한을 해제하면 작성·수정 권한도 함께 해제됩니다.
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
              {saving ? "저장 중..." : "권한 저장"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
