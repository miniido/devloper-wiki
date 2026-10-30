import { useEffect, useState } from "react";
import "./UserManager.css";

interface WikiUser {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  is_superuser: boolean;
  roles: string[];
}

interface ManagementResponse {
  users: WikiUser[];
  roles: string[];
}

interface Props {
  currentUserId: number;
}

type FormState = {
  username: string;
  first_name: string;
  last_name: string;
  role: string;
  password: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  username: "",
  first_name: "",
  last_name: "",
  role: "",
  password: "",
  is_active: true,
};

function csrfToken(): string {
  const cookie = document.cookie
    .split("; ")
    .find((value) => value.startsWith("csrftoken="));

  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : "";
}

async function request<T>(
  url: string,
  method = "GET",
  body?: object,
): Promise<T> {
  if (method !== "GET") {
    const csrf = await fetch("/api/csrf/", {
      credentials: "same-origin",
    });

    if (!csrf.ok) throw new Error("CSRF 발급 실패");
  }

  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      ...(method !== "GET" ? { "X-CSRFToken": csrfToken() } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.detail ?? `요청 실패 (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function formFromUser(user: WikiUser): FormState {
  return {
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.roles[0] ?? "",
    password: "",
    is_active: user.is_active,
  };
}

export default function UserManager({ currentUserId }: Props) {
  const [users, setUsers] = useState<WikiUser[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const selectedUser = users.find((u) => u.id === selectedId);
  const isSelf = selectedId === currentUserId;

  async function loadUsers() {
    const result = await request<ManagementResponse>("/api/user-management/");

    setUsers(result.users);
    setRoles(result.roles);
    return result;
  }

  useEffect(() => {
    let cancelled = false;

    request<ManagementResponse>("/api/user-management/")
      .then((data) => {
        if (!cancelled) {
          setUsers(data.users);
          setRoles(data.roles);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function chooseUser(user: WikiUser) {
    setSelectedId(user.id);
    setCreating(false);
    setForm(formFromUser(user));
    setResetPasswordOpen(false);
    setNewPassword("");
    setError("");
    setNotice("");
  }

  function startCreate() {
    setSelectedId(null);
    setCreating(true);
    setForm({
      ...emptyForm,
      role: roles.includes("AUTHOR") ? "AUTHOR" : (roles[0] ?? ""),
    });
    setResetPasswordOpen(false);
    setError("");
    setNotice("");
  }

  async function saveUser() {
    if (busy || isSelf) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (creating) {
        const created = await request<WikiUser>(
          "/api/user-management/",
          "POST",
          {
            username: form.username.trim(),
            first_name: form.first_name.trim(),
            last_name: form.last_name.trim(),
            password: form.password,
            role: form.role,
          },
        );

        const data = await loadUsers();
        const user = data.users.find((u) => u.id === created.id) ?? created;

        chooseUser(user);
        setNotice("사용자가 생성되었습니다.");
      } else if (selectedUser) {
        const updated = await request<WikiUser>(
          `/api/user-management/${selectedUser.id}/`,
          "PATCH",
          {
            first_name: form.first_name.trim(),
            last_name: form.last_name.trim(),
            role: form.role,
            is_active: form.is_active,
          },
        );

        await loadUsers();
        chooseUser(updated);
        setNotice("사용자 정보가 저장되었습니다.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!selectedUser || busy || isSelf) return;

    if (!window.confirm("비밀번호를 변경할까요?")) return;

    setBusy(true);
    setError("");
    setNotice("");

    try {
      await request<{ detail: string }>(
        `/api/user-management/${selectedUser.id}/reset-password/`,
        "POST",
        { password: newPassword },
      );

      setNewPassword("");
      setResetPasswordOpen(false);
      setNotice("비밀번호가 변경되었습니다.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "비밀번호 변경 실패");
    } finally {
      setBusy(false);
    }
  }

  const filtered = users.filter((u) => {
    const name = `${u.last_name}${u.first_name}`;
    const keyword = query.toLowerCase().trim();

    return (
      u.username.toLowerCase().includes(keyword) ||
      name.toLowerCase().includes(keyword)
    );
  });

  return (
    <section className="user-manager">
      <div className="um-header">
        <div>
          <h1>사용자 관리</h1>
          <p>팀원 계정과 접근 역할을 관리합니다.</p>
        </div>
        <button
          className="um-primary"
          type="button"
          onClick={startCreate}
          disabled={loading || roles.length === 0}
        >
          + 사용자 추가
        </button>
      </div>

      {error && <div className="um-error">{error}</div>}
      {notice && <div className="um-notice">{notice}</div>}

      {loading ? (
        <p className="um-muted">사용자 정보를 불러오는 중...</p>
      ) : (
        <div className="um-layout">
          <aside className="um-list-panel">
            <div className="um-search">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="이름 또는 아이디 검색"
                aria-label="사용자 검색"
              />
            </div>

            <div className="um-count">사용자 {filtered.length}명</div>

            {filtered.map((user) => (
              <button
                type="button"
                key={user.id}
                className={`um-user ${
                  !creating && selectedId === user.id ? "selected" : ""
                }`}
                onClick={() => chooseUser(user)}
              >
                <span className="um-avatar">
                  {user.username.charAt(0).toUpperCase()}
                </span>

                <span className="um-user-info">
                  <strong>{user.username}</strong>
                  <small>{user.roles.join(", ") || "역할 없음"}</small>
                </span>

                <span
                  className={`um-status ${
                    user.is_active ? "active" : "inactive"
                  }`}
                  title={user.is_active ? "활성" : "비활성"}
                />
              </button>
            ))}

            {filtered.length === 0 && (
              <p className="um-muted">검색 결과가 없습니다.</p>
            )}
          </aside>

          <div className="um-detail">
            {!creating && !selectedUser ? (
              <div className="um-placeholder">
                <strong>사용자를 선택해 주세요.</strong>
                <p>계정 정보를 조회하거나 새 사용자를 추가할 수 있습니다.</p>
              </div>
            ) : (
              <>
                <div className="um-detail-header">
                  <h2>{creating ? "새 사용자" : "사용자 정보"}</h2>
                  {!creating && selectedUser && (
                    <span className="um-muted">ID #{selectedUser.id}</span>
                  )}
                </div>

                <div className="um-fields">
                  <label htmlFor="um-username">아이디</label>
                  <input
                    id="um-username"
                    value={form.username}
                    disabled={!creating || busy}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        username: e.target.value,
                      }))
                    }
                  />

                  <div className="um-name-fields">
                    <div>
                      <label htmlFor="um-last-name">성</label>
                      <input
                        id="um-last-name"
                        value={form.last_name}
                        disabled={busy || isSelf}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            last_name: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor="um-first-name">이름</label>
                      <input
                        id="um-first-name"
                        value={form.first_name}
                        disabled={busy || isSelf}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            first_name: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>

                  <label htmlFor="um-role">역할</label>
                  <select
                    id="um-role"
                    value={form.role}
                    disabled={busy || isSelf}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        role: e.target.value,
                      }))
                    }
                  >
                    <option value="" disabled>
                      역할 선택
                    </option>
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>

                  {creating && (
                    <>
                      <label htmlFor="um-password">초기 비밀번호</label>
                      <input
                        id="um-password"
                        type="password"
                        value={form.password}
                        autoComplete="new-password"
                        disabled={busy}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            password: e.target.value,
                          }))
                        }
                      />
                    </>
                  )}

                  {!creating && (
                    <label className="um-toggle">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        disabled={busy || isSelf}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            is_active: e.target.checked,
                          }))
                        }
                      />
                      <span>활성 계정</span>
                    </label>
                  )}
                </div>

                <div className="um-actions">
                  <button
                    type="button"
                    className="um-primary"
                    disabled={
                      busy ||
                      isSelf ||
                      !form.username.trim() ||
                      !form.role ||
                      (creating && !form.password)
                    }
                    onClick={() => void saveUser()}
                  >
                    {busy
                      ? "처리 중..."
                      : creating
                        ? "사용자 생성"
                        : "변경사항 저장"}
                  </button>
                </div>

                {!creating && !isSelf && (
                  <div className="um-password-section">
                    <div>
                      <strong>비밀번호 초기화</strong>
                      <p>관리자가 새 비밀번호를 지정합니다.</p>
                    </div>

                    {!resetPasswordOpen ? (
                      <button
                        type="button"
                        className="um-secondary"
                        onClick={() => setResetPasswordOpen(true)}
                      >
                        비밀번호 변경
                      </button>
                    ) : (
                      <div className="um-reset-form">
                        <input
                          type="password"
                          placeholder="새 비밀번호"
                          autoComplete="new-password"
                          value={newPassword}
                          disabled={busy}
                          onChange={(e) => setNewPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          className="um-secondary"
                          disabled={busy || !newPassword}
                          onClick={() => void resetPassword()}
                        >
                          변경 확인
                        </button>
                        <button
                          type="button"
                          className="um-text-button"
                          onClick={() => {
                            setResetPasswordOpen(false);
                            setNewPassword("");
                          }}
                        >
                          취소
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
