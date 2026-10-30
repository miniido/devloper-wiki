import { useRef } from "react";
import { useEffect, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import WikiEditor from "./components/WikiEditor";
import type { WikiEditorHandle } from "./components/WikiEditor";
import "./App.css";
import LoginPage from "./components/LoginPage";
import AttachmentSection from "./components/AttachmentSection";
import RevisionHistory from "./components/RevisionHistory";
import MenuManager from "./components/MenuManager";
import { sortMenusAsTree, menuAncestors } from "./menuTree";
import Icon from "./components/Icon";
import UserMenu from "./components/UserMenu";
import UserManager from "./components/UserManager";

interface Menu {
  id: number;
  name: string;
  parent: number | null;
  sort_order: number;
  can_create: boolean;
}

interface WikiDocument {
  id: number;
  menu: number;
  title: string;
  content: PartialBlock[];
  created_by: string;
  updated_at: string;
  can_edit: boolean;
  version: number;
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
    const result = await response.json().catch(() => ({}));
    throw new Error(result.detail || `요청 실패 (${response.status})`);
  }

  return response.json();
}

function WikiApp({
  onLogout,
  user,
}: {
  onLogout: () => Promise<void>;
  user: AuthUser;
}) {
  const editorRef = useRef<WikiEditorHandle>(null);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [documents, setDocuments] = useState<WikiDocument[]>([]);
  const [selectedMenu, setSelectedMenu] = useState<number | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<WikiDocument | null>(null);
  const [mode, setMode] = useState<PageMode>("home");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WikiDocument[]>([]);
  const [searching, setSearching] = useState(false);
  const [menuManagement, setMenuManagement] = useState(false);
  const canManageMenus = user.can_manage_menus;
  const [expandedMenuIds, setExpandedMenuIds] = useState<Set<number>>(
    new Set(),
  );
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [searched, setSearched] = useState(false);
  const [userManagement, setUserManagement] = useState(false);
  const [canManageUsers, setCanManageUsers] = useState(false);

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
      .then((data) => {
        if (!controller.signal.aborted) {
          setDocuments(data);
          setLoadingDocuments(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message);
          setLoadingDocuments(false);
        }
      });

    return () => controller.abort();
  }, [selectedMenu]);

  useEffect(() => {
    fetch("/api/user-management/", {
      credentials: "same-origin",
    })
      .then((response) => {
        if (response.status === 403 || response.status === 401) {
          setCanManageUsers(false);
          return;
        }

        if (!response.ok) {
          throw new Error("사용자 관리 권한 확인 실패");
        }

        setCanManageUsers(true);
      })
      .catch(() => setCanManageUsers(false));
  }, []);

  function selectMenu(id: number) {
    setExpandedMenuIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (selectedMenu !== id) {
      setSelectedMenu(id);
      setDocuments([]);
      setLoadingDocuments(true);
    }
    setSelectedDoc(null);
    setMode("home");
    setMenuManagement(false);
    setUserManagement(false);
    setError("");
  }

  function openDocument(doc: WikiDocument) {
    setExpandedMenuIds(
      (previous) =>
        new Set([
          ...previous,
          doc.menu,
          ...menuAncestors(menus, doc.menu).map((item) => item.id),
        ]),
    );
    if (selectedMenu !== doc.menu) {
      setLoadingDocuments(true);
      setDocuments([]);
    }
    setSelectedMenu(doc.menu);
    setMenuManagement(false);
    setSidebarOpen(false);
    setSelectedDoc(doc);
    setTitle(doc.title);
    setMode("view");
    setError("");
  }

  function createDocument() {
    const menu = menus.find((item) => item.id === selectedMenu);

    if (!menu) {
      setError("왼쪽에서 작성 가능한 메뉴를 먼저 선택해 주세요.");
      return;
    }
    if (!menu.can_create) {
      setError("이 메뉴에는 문서 작성 권한이 없습니다.");
      return;
    }
    setMenuManagement(false);
    setSidebarOpen(false);

    setSelectedDoc(null);
    setTitle("");
    setMode("create");
    setError("");
  }

  async function saveDocument(content: unknown[]) {
    if (saving) return;
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
          version: selectedDoc?.version,
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
  async function searchDocuments() {
    const keyword = searchQuery.trim();

    if (!keyword) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setSearched(false);
    setError("");

    try {
      const results = await apiRequest<WikiDocument[]>(
        `/api/documents/?q=${encodeURIComponent(keyword)}`,
      );

      setSearchResults(results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "검색 실패");
    } finally {
      setSearching(false);
    }
  }

  function openSearchResult(doc: WikiDocument) {
    openDocument(doc);
    setSearchQuery("");
    setSearchResults([]);
  }

  const currentMenu = menus.find((menu) => menu.id === selectedMenu);

  const breadcrumb =
    selectedMenu === null
      ? "팀 지식 공간"
      : [...menuAncestors(menus, selectedMenu), currentMenu]
          .filter(Boolean)
          .map((menu) => menu?.name)
          .join(" / ");
  return (
    <div className="app">
      <header className="header" inert={saving}>
        <button
          className="menu-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="메뉴 열기"
          aria-expanded={sidebarOpen}
        >
          <Icon name="menu" />
        </button>

        <button
          className="brand"
          onClick={() => {
            setMenuManagement(false);
            setUserManagement(false);
            setSelectedMenu(null);
            setSelectedDoc(null);
            setMode("home");
          }}
        >
          <span className="brand-mark">D.</span>
          <span>Developer Wiki</span>
        </button>

        <nav className="header-breadcrumb" aria-label="현재 위치">
          {menuManagement ? "관리 / 메뉴 관리" : breadcrumb}
        </nav>
        <UserMenu user={user} onLogout={onLogout} />
      </header>

      <div className="layout">
        {sidebarOpen && (
          <div className="overlay" onClick={() => setSidebarOpen(false)} />
        )}

        <aside
          className={`sidebar ${sidebarOpen ? "open" : ""}`}
          inert={saving}
        >
          <button
            className={`sidebar-home ${selectedMenu === null && !menuManagement ? "active" : ""}`}
            onClick={() => {
              setSelectedMenu(null);
              setSelectedDoc(null);
              setMenuManagement(false);
              setMode("home");
              setSidebarOpen(false);
            }}
          >
            <Icon name="search" /> 검색 및 둘러보기
          </button>
          <div className="sidebar-scroll">
            <div className="sidebar-heading">
              WORKSPACE <span>{menus.length}</span>
            </div>
            <nav aria-label="위키 메뉴">
              {sortMenusAsTree(menus)
                .filter(({ menu }) =>
                  menuAncestors(menus, menu.id).every((ancestor) =>
                    expandedMenuIds.has(ancestor.id),
                  ),
                )
                .map(({ menu, depth }) => {
                  const isSelected =
                    selectedMenu === menu.id && !menuManagement;
                  const expanded = expandedMenuIds.has(menu.id);
                  return (
                    <div className="sidebar-group" key={menu.id}>
                      <button
                        className={`sidebar-item ${isSelected ? "active" : ""}`}
                        style={{ paddingLeft: 10 + depth * 16 }}
                        onClick={() => selectMenu(menu.id)}
                        aria-expanded={expanded}
                        aria-current={isSelected ? "page" : undefined}
                      >
                        <Icon
                          name="chevron"
                          className={expanded ? "chevron expanded" : "chevron"}
                        />
                        <Icon name={expanded ? "folderOpen" : "folder"} />
                        <span className="sidebar-label">{menu.name}</span>
                      </button>
                      {isSelected && expanded && (
                        <div
                          className="sidebar-documents"
                          style={{ marginLeft: 26 + depth * 16 }}
                        >
                          {loadingDocuments ? (
                            <p className="hint">불러오는 중…</p>
                          ) : (
                            documents.map((doc) => (
                              <button
                                key={doc.id}
                                className={`sidebar-document ${selectedDoc?.id === doc.id ? "active" : ""}`}
                                onClick={() => openDocument(doc)}
                                aria-current={
                                  selectedDoc?.id === doc.id
                                    ? "page"
                                    : undefined
                                }
                              >
                                <Icon name="file" />
                                <span className="sidebar-doc-title">
                                  {doc.title}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              {menus.length === 0 && (
                <p className="hint">접근 가능한 메뉴가 없습니다.</p>
              )}
            </nav>
            {canManageMenus && (
              <nav className="admin-section" aria-label="관리">
                <div className="sidebar-heading">관리</div>
                <button
                  className={`sidebar-item ${menuManagement ? "active" : ""}`}
                  onClick={() => {
                    setMenuManagement(true);
                    setUserManagement(false);
                    setSidebarOpen(false);
                  }}
                >
                  <Icon name="settings" />
                  메뉴 관리
                </button>
                {canManageUsers && (
                  <button
                    type="button"
                    onClick={() => {
                      setUserManagement(true);
                      setMenuManagement(false);
                    }}
                  >
                    사용자 관리
                  </button>
                )}
                <button
                  className="sidebar-item"
                  disabled
                  title="사용자 관리는 준비 중입니다"
                >
                  <Icon name="users" />
                  사용자 관리 <span className="soon">준비 중</span>
                </button>
              </nav>
            )}
          </div>
          <div className="sidebar-footer">
            <button
              className="new-document-button"
              onClick={createDocument}
              disabled={selectedMenu !== null && !currentMenu?.can_create}
              title={
                currentMenu && !currentMenu.can_create
                  ? "문서 작성 권한이 없습니다"
                  : "선택한 메뉴에 새 문서 작성"
              }
            >
              <Icon name="plus" />새 문서
            </button>
            <span>함께 쌓아가는 팀의 지식</span>
          </div>
        </aside>

        <main className="main">
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          {userManagement ? (
            <UserManager currentUserId={user.id} />
          ) : menuManagement && canManageMenus ? (
            <MenuManager
              onClose={() => setMenuManagement(false)}
              onChanged={async () => {
                const updated = await apiRequest<Menu[]>("/api/menus/");

                setMenus(updated);
                setSelectedMenu(null);
                setSelectedDoc(null);
                setDocuments([]);
                setMode("home");
              }}
            />
          ) : selectedMenu === null ? (
            <div className="welcome">
              <div className="eyebrow">TEAM KNOWLEDGE</div>
              <h1>팀의 기록을 한곳에.</h1>
              <p>
                개발 가이드와 해결 기록, 프로젝트 자료를 모아두는 공간입니다.
              </p>

              <form
                className="wiki-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void searchDocuments();
                }}
              >
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="문서 제목, 오류 메시지, 기술명 검색..."
                  aria-label="위키 문서 검색"
                />
                <button type="submit" disabled={searching}>
                  {searching ? "검색 중" : "검색"}
                </button>
              </form>

              {searched && searchQuery.trim() && searchResults.length === 0 && (
                <p className="hint" role="status">
                  일치하는 문서가 없습니다. 다른 검색어로 시도해 주세요.
                </p>
              )}
              {searchQuery.trim() && searchResults.length > 0 && (
                <div className="search-results">
                  <div className="search-results-heading">
                    검색 결과 · {searchResults.length}건
                  </div>

                  {searchResults.map((doc) => (
                    <button
                      key={doc.id}
                      className="search-result-item"
                      onClick={() => void openSearchResult(doc)}
                    >
                      <span className="search-result-title">{doc.title}</span>
                      <span className="search-result-meta">
                        {menus.find((menu) => menu.id === doc.menu)?.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="content-area">
              <div className="breadcrumb">
                {breadcrumb}
                {selectedDoc && ` / ${selectedDoc.title}`}
              </div>

              {mode === "home" && (
                <>
                  <div className="page-heading">
                    <h1>{currentMenu?.name}</h1>
                    <span className="count-label">
                      {documents.length}개의 문서
                    </span>
                  </div>

                  <div className="document-list">
                    {loadingDocuments ? (
                      <p className="hint">문서를 불러오는 중…</p>
                    ) : documents.length === 0 ? (
                      <p className="hint">아직 등록된 문서가 없습니다.</p>
                    ) : (
                      documents.map((doc) => (
                        <button
                          key={doc.id}
                          className="document-item"
                          onClick={() => openDocument(doc)}
                        >
                          <Icon name="file" />
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

              {((mode === "create" && currentMenu?.can_create) ||
                (mode === "edit" && selectedDoc?.can_edit)) && (
                <div className="document-page">
                  <div className="document-topbar document-toolbar">
                    <span className="document-location">
                      <Icon name="edit" />
                      {mode === "create" ? "새 문서 작성" : "문서 편집"}
                    </span>
                    <div
                      className="document-actions"
                      aria-label="문서 편집 작업"
                    >
                      <button
                        className="document-action-button document-action-cancel"
                        disabled={saving}
                        onClick={() => setMode(selectedDoc ? "view" : "home")}
                      >
                        <Icon name="close" />
                        취소
                      </button>
                      <button
                        className="document-action-button document-action-save"
                        disabled={saving || !title.trim()}
                        onClick={() => {
                          if (editorRef.current)
                            void saveDocument(editorRef.current.getContent());
                        }}
                      >
                        <Icon name="save" />
                        {saving ? "저장 중..." : "문서 저장"}
                      </button>
                    </div>
                  </div>

                  <input
                    className="document-title-input"
                    aria-label="문서 제목"
                    maxLength={200}
                    disabled={saving}
                    placeholder="문서 제목"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />

                  <div className="document-editor-area">
                    <WikiEditor
                      key={`edit-${selectedDoc?.id ?? "new"}-${selectedDoc?.version ?? 0}`}
                      documentId={selectedDoc?.id}
                      initialContent={selectedDoc?.content}
                      editable={!saving}
                      editorRef={editorRef}
                    />
                  </div>
                  {selectedDoc && (
                    <div className="document-attachment-area">
                      <AttachmentSection
                        key={selectedDoc.id}
                        documentId={selectedDoc.id}
                        canEdit={selectedDoc.can_edit}
                        editMode={true}
                      />
                    </div>
                  )}
                </div>
              )}

              {mode === "view" && selectedDoc && (
                <article className="document-page document-view">
                  <div className="document-topbar">
                    <span className="document-location">
                      <Icon name="file" /> 문서
                    </span>

                    {selectedDoc.can_edit && (
                      <button
                        className="document-action-button document-action-edit"
                        onClick={() => setMode("edit")}
                      >
                        <Icon name="edit" />
                        수정
                      </button>
                    )}
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
                      <span className="version-badge">
                        v{selectedDoc.version}
                      </span>
                    </div>
                  </div>

                  <div className="document-body">
                    <h2 className="body-section-label">
                      <Icon name="file" />
                      본문
                    </h2>
                    <div className="document-editor-area">
                      <WikiEditor
                        key={`view-${selectedDoc.id}-${selectedDoc.version}`}
                        documentId={selectedDoc.id}
                        initialContent={selectedDoc.content}
                        editable={false}
                      />
                    </div>

                    <div className="document-attachment-area">
                      <AttachmentSection
                        key={selectedDoc.id}
                        documentId={selectedDoc.id}
                        canEdit={selectedDoc.can_edit}
                        editMode={false}
                      />
                    </div>

                    <div className="document-revision-area">
                      <RevisionHistory
                        key={selectedDoc.id}
                        documentId={selectedDoc.id}
                        currentVersion={selectedDoc.version}
                        canEdit={selectedDoc.can_edit}
                        onRestored={async () => {
                          const updated = await apiRequest<WikiDocument>(
                            `/api/documents/${selectedDoc.id}/`,
                          );
                          openDocument(updated);
                          const list = await apiRequest<WikiDocument[]>(
                            `/api/documents/?menu=${updated.menu}`,
                          );
                          setDocuments(list);
                        }}
                      />
                    </div>
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
  role: string;
  role_label: string;
  can_manage_menus: boolean;
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

  return <WikiApp onLogout={handleLogout} user={user} />;
}

export default App;
