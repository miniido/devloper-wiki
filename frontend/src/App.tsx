import { useEffect, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import WikiEditor from "./components/WikiEditor";
import "./App.css";
import LoginPage from "./components/LoginPage";

interface Menu {
  id: number;
  name: string;
  parent: number | null;
  sort_order: number;
}

interface WikiDocument {
  id: number;
  menu: number;
  title: string;
  content: PartialBlock[];
  created_by: string;
  updated_at: string;
}

type PageMode = "home" | "view" | "create" | "edit";

function getCookie(name: string): string {
  const item = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${name}=`));

  return item ? decodeURIComponent(item.split("=")[1]) : "";
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });

  if (!response.ok) {
    throw new Error(`요청 실패 (${response.status})`);
  }

  return response.json();
}

function WikiApp({ onLogout }: { onLogout: () => Promise<void> }) {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [documents, setDocuments] = useState<WikiDocument[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<number | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<WikiDocument | null>(null);
  const [mode, setMode] = useState<PageMode>("home");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest<Menu[]>("/api/menus/")
      .then(setMenus)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (selectedMenu === null) return;

    const controller = new AbortController();

    apiRequest<WikiDocument[]>(`/api/documents/?menu=${selectedMenu}`, {
      signal: controller.signal,
    })
      .then(setDocuments)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });

    return () => controller.abort();
  }, [selectedMenu]);

  function selectMenu(id: number) {
    setSelectedMenu(id);
    setSelectedDoc(null);
    setDocuments([]);
    setMode("home");
    setSidebarOpen(false);
    setError("");
  }

  function openDocument(doc: WikiDocument) {
    setSelectedDoc(doc);
    setTitle(doc.title);
    setMode("view");
    setError("");
  }

  function createDocument() {
    setSelectedDoc(null);
    setTitle("");
    setMode("create");
    setError("");
  }

  async function saveDocument(content: unknown[]) {
    if (!title.trim() || selectedMenu === null) {
      setError("문서 제목을 입력해 주세요.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      // CSRF 쿠키 발급
      await apiRequest("/api/csrf/");

      const isEdit = mode === "edit" && selectedDoc !== null;
      const url = isEdit
        ? `/api/documents/${selectedDoc.id}/`
        : "/api/documents/";

      const saved = await apiRequest<WikiDocument>(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCookie("csrftoken"),
        },
        body: JSON.stringify({
          menu: selectedMenu,
          title: title.trim(),
          content,
        }),
      });

      const updated = await apiRequest<WikiDocument[]>(
        `/api/documents/?menu=${selectedMenu}`,
      );

      setDocuments(updated);
      setSelectedDoc(saved);
      setMode("view");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  const currentMenu = menus.find((menu) => menu.id === selectedMenu);

  return (
    <div className="app">
      <header className="header">
        <button
          className="menu-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="메뉴 열기"
        >
          ☰
        </button>

        <button
          className="brand"
          onClick={() => {
            setSelectedMenu(null);
            setSelectedDoc(null);
            setMode("home");
          }}
        >
          <span className="brand-mark">D.</span>
          <span>Developer Wiki</span>
        </button>

        <span className="header-label">Developer Wiki</span>
        <div className="header-actions">
          <button className="logout-button" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      </header>

      <div className="layout">
        {sidebarOpen && (
          <div className="overlay" onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-heading">WORKSPACE</div>

          {menus.map((menu) => {
            const isSelected = selectedMenu === menu.id;
            const menuDocuments = isSelected ? documents : [];

            return (
              <div className="sidebar-group" key={menu.id}>
                <button
                  className={`sidebar-item ${isSelected ? "active" : ""}`}
                  style={{ paddingLeft: menu.parent ? 28 : 12 }}
                  onClick={() => selectMenu(menu.id)}
                >
                  <span className="sidebar-chevron">
                    {isSelected ? "⌄" : "›"}
                  </span>
                  <span className="sidebar-label">{menu.name}</span>
                </button>

                {isSelected && (
                  <div className="sidebar-documents">
                    {menuDocuments.map((doc) => (
                      <button
                        key={doc.id}
                        className={`sidebar-document ${
                          selectedDoc?.id === doc.id ? "active" : ""
                        }`}
                        onClick={() => {
                          openDocument(doc);
                          setSidebarOpen(false);
                        }}
                      >
                        <span className="sidebar-doc-icon">▤</span>
                        <span className="sidebar-doc-title">{doc.title}</span>
                      </button>
                    ))}

                    <button
                      className="sidebar-add"
                      onClick={() => {
                        createDocument();
                        setSidebarOpen(false);
                      }}
                    >
                      + 새 문서
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        <main className="main">
          {error && <div className="error">{error}</div>}

          {selectedMenu === null ? (
            <div className="welcome">
              <div className="eyebrow">TEAM KNOWLEDGE</div>
              <h1>팀의 기록을 한곳에.</h1>
              <p>
                개발 가이드와 해결 기록, 프로젝트 자료를 모아두는 공간입니다.
              </p>
            </div>
          ) : (
            <div className="content-area">
              {mode !== "view" && (
                <div className="breadcrumb">
                  {currentMenu?.name}
                  {selectedDoc && ` / ${selectedDoc.title}`}
                </div>
              )}

              {mode === "home" && (
                <>
                  <div className="page-heading">
                    <h1>{currentMenu?.name}</h1>
                    <button className="primary-button" onClick={createDocument}>
                      + 새 문서
                    </button>
                  </div>

                  <div className="document-list">
                    {documents.length === 0 ? (
                      <p className="hint">아직 등록된 문서가 없습니다.</p>
                    ) : (
                      documents.map((doc) => (
                        <button
                          key={doc.id}
                          className="document-item"
                          onClick={() => openDocument(doc)}
                        >
                          <span>▤</span>
                          <span>{doc.title}</span>
                          <span className="document-date">
                            {new Date(doc.updated_at).toLocaleDateString(
                              "ko-KR",
                            )}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}

              {(mode === "create" || mode === "edit") && (
                <div className="document-page">
                  <div className="document-toolbar">
                    <button
                      className="text-button"
                      onClick={() => setMode(selectedDoc ? "view" : "home")}
                    >
                      ← 취소
                    </button>
                  </div>

                  <input
                    className="document-title-input"
                    placeholder="문서 제목"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />

                  <WikiEditor
                    key={`edit-${selectedDoc?.id ?? "new"}`}
                    initialContent={selectedDoc?.content}
                    editable
                    onSave={saveDocument}
                    saving={saving}
                  />
                </div>
              )}

              {mode === "view" && selectedDoc && (
                <article className="document-page document-view">
                  <div className="document-topbar">
                    <span className="document-location">
                      {currentMenu?.name} / 문서
                    </span>

                    <button
                      className="secondary-button"
                      onClick={() => setMode("edit")}
                    >
                      수정
                    </button>
                  </div>

                  <div className="document-header">
                    <h1 className="document-title">{selectedDoc.title}</h1>

                    <div className="document-meta">
                      <span className="author-avatar">
                        {selectedDoc.created_by.charAt(0).toUpperCase()}
                      </span>
                      <span>{selectedDoc.created_by}</span>
                      <span className="meta-separator">·</span>
                      <span>
                        {new Date(selectedDoc.updated_at).toLocaleDateString(
                          "ko-KR",
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="document-body">
                    <WikiEditor
                      key={`view-${selectedDoc.id}`}
                      initialContent={selectedDoc.content}
                      editable={false}
                    />
                  </div>
                </article>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

interface AuthUser {
  id: number;
  username: string;
  is_staff: boolean;
  is_superuser: boolean;
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [authError, setAuthError] = useState("");

  async function checkLogin() {
    const response = await fetch("/api/auth/me/", {
      credentials: "same-origin",
    });

    if (response.status === 401 || response.status === 403) {
      setUser(null);
      return;
    }

    if (!response.ok) {
      throw new Error(`로그인 상태 확인 실패 (${response.status})`);
    }

    setUser(await response.json());
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me/", {
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          return null;
        }

        if (!response.ok) {
          throw new Error(`로그인 상태 확인 실패 (${response.status})`);
        }

        return response.json() as Promise<AuthUser>;
      })
      .then((user) => {
        if (!cancelled) {
          setUser(user);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setAuthError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    setAuthError("");

    try {
      const csrfResponse = await fetch("/api/csrf/", {
        credentials: "same-origin",
      });

      if (!csrfResponse.ok) {
        throw new Error("보안 토큰을 가져오지 못했습니다.");
      }

      const csrfCookie = document.cookie
        .split("; ")
        .find((item) => item.startsWith("csrftoken="));

      const token = csrfCookie
        ? decodeURIComponent(csrfCookie.substring("csrftoken=".length))
        : "";

      const response = await fetch("/api/auth/logout/", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "X-CSRFToken": token,
        },
      });

      if (!response.ok) {
        throw new Error(`로그아웃 실패 (${response.status})`);
      }

      setUser(null);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : "로그아웃에 실패했습니다.",
      );
    }
  }

  if (checking) {
    return <div className="auth-loading">Developer Wiki</div>;
  }

  if (authError) {
    return (
      <div className="auth-loading">
        <p>{authError}</p>
        <button onClick={() => window.location.reload()}>다시 시도</button>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={checkLogin} />;
  }

  return <WikiApp onLogout={handleLogout} />;
}

export default App;
