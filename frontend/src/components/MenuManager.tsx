import Icon from "./Icon";
import { useEffect, useState } from "react";
import { sortMenusAsTree, menuAncestors } from "../menuTree";
import MenuAccessEditor from "./MenuAccessEditor";

interface MenuItem {
  id: number;
  name: string;
  parent: number | null;
  sort_order: number;
  is_public: boolean;
}

interface ManagementData {
  can_add: boolean;
  can_change: boolean;
  can_delete: boolean;
  menus: MenuItem[];
}

interface Props {
  onClose: () => void;
  onChanged: () => Promise<void>;
}

interface FormValues {
  name: string;
  parent: number | null;
  sort_order: number;
  is_public: boolean;
}

const EMPTY_FORM: FormValues = {
  name: "",
  parent: null,
  sort_order: 0,
  is_public: false,
};

function csrfToken() {
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith("csrftoken="));

  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : "";
}

export default function MenuManager({ onClose, onChanged }: Props) {
  const [data, setData] = useState<ManagementData | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadMenus() {
    const response = await fetch("/api/menu-management/");

    if (!response.ok) {
      throw new Error("메뉴 관리 정보를 불러오지 못했습니다.");
    }

    setData(await response.json());
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/menu-management/")
      .then(async (res) => {
        if (!res.ok) throw new Error("메뉴 조회 실패");
        return res.json() as Promise<ManagementData>;
      })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function chooseMenu(menu: MenuItem) {
    setSelected(menu.id);
    setForm({
      name: menu.name,
      parent: menu.parent,
      sort_order: menu.sort_order,
      is_public: menu.is_public,
    });
    setError("");
  }

  function newMenu() {
    setSelected(null);
    setForm({ ...EMPTY_FORM });
    setError("");
  }

  // 자기 자신 및 하위 메뉴는 상위 메뉴 후보에서 제외
  function isDescendant(candidateId: number, menuId: number) {
    let current = data?.menus.find((m) => m.id === candidateId);

    const visited = new Set<number>();
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (current.id === menuId) return true;
      current = data?.menus.find((m) => m.id === current?.parent);
    }

    return false;
  }

  async function sendRequest(
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: FormValues,
  ) {
    const csrf = await fetch("/api/csrf/");

    if (!csrf.ok) {
      throw new Error("보안 토큰 발급에 실패했습니다.");
    }

    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: {
        "X-CSRFToken": csrfToken(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.detail || `요청 실패 (${response.status})`);
    }
  }

  async function saveMenu() {
    if (!form.name.trim() || busy) return;

    setBusy(true);
    setError("");

    try {
      await sendRequest(
        selected === null
          ? "/api/menu-management/"
          : `/api/menu-management/${selected}/`,
        selected === null ? "POST" : "PATCH",
        { ...form, name: form.name.trim() },
      );

      await loadMenus();
      await onChanged();
      newMenu();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  async function deleteMenu() {
    if (selected === null || busy) return;

    const menu = data?.menus.find((m) => m.id === selected);

    if (!window.confirm(`"${menu?.name}" 메뉴를 삭제할까요?`)) return;

    setBusy(true);
    setError("");

    try {
      await sendRequest(`/api/menu-management/${selected}/`, "DELETE");

      await loadMenus();
      await onChanged();
      newMenu();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="menu-manager">
      <div className="menu-manager-heading">
        <div>
          <h1>메뉴 관리</h1>
          <p>위키의 메뉴 구조와 공개 범위를 설정합니다.</p>
        </div>
        <button className="text-button" onClick={onClose}>
          닫기
        </button>
      </div>

      {error && <p className="attachment-error">{error}</p>}

      {!data ? (
        <p className="hint">메뉴를 불러오는 중...</p>
      ) : (
        <div className="menu-manager-layout">
          <div className="menu-manager-list">
            <div className="menu-manager-list-heading">
              <strong>메뉴 목록</strong>
              {data.can_add && (
                <button type="button" onClick={newMenu}>
                  + 추가
                </button>
              )}
            </div>

            {sortMenusAsTree(data.menus).map(({ menu, depth }) => (
              <button
                type="button"
                key={menu.id}
                className={selected === menu.id ? "active" : ""}
                style={{
                  paddingLeft: 12 + depth * 18,
                }}
                onClick={() => chooseMenu(menu)}
              >
                <span>{menu.name}</span>
                <small>{menu.is_public ? "전체 공개" : "권한 제한"}</small>
              </button>
            ))}
          </div>

          <div className="menu-manager-form">
            <h2>{selected === null ? "새 메뉴" : "메뉴 수정"}</h2>

            <label htmlFor="menu-name">메뉴 이름</label>
            <input
              id="menu-name"
              value={form.name}
              disabled={
                busy || (selected === null ? !data.can_add : !data.can_change)
              }
              maxLength={100}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  name: e.target.value,
                }))
              }
              placeholder="예: 서버 운영 가이드"
            />

            <label htmlFor="menu-parent">상위 메뉴</label>
            <select
              id="menu-parent"
              value={form.parent ?? ""}
              disabled={
                busy || (selected === null ? !data.can_add : !data.can_change)
              }
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  parent: e.target.value ? Number(e.target.value) : null,
                }))
              }
            >
              <option value="">최상위 메뉴</option>
              {sortMenusAsTree(data.menus)
                .filter(
                  ({ menu }) =>
                    selected === null || !isDescendant(menu.id, selected),
                )
                .map(({ menu }) => (
                  <option key={menu.id} value={menu.id}>
                    {[...menuAncestors(data.menus, menu.id), menu]
                      .map((item) => item.name)
                      .join(" / ")}
                  </option>
                ))}
            </select>

            <label htmlFor="menu-order">정렬 순서</label>
            <input
              id="menu-order"
              type="number"
              step={1}
              min={0}
              value={form.sort_order}
              disabled={
                busy || (selected === null ? !data.can_add : !data.can_change)
              }
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  sort_order: Number(e.target.value),
                }))
              }
            />

            <p className="menu-manager-help">
              같은 상위 메뉴 안에서 작은 숫자가 먼저 표시됩니다.
            </p>
            <label className="menu-manager-checkbox">
              <input
                type="checkbox"
                checked={form.is_public}
                disabled={
                  busy || (selected === null ? !data.can_add : !data.can_change)
                }
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    is_public: e.target.checked,
                  }))
                }
              />
              로그인 사용자에게 전체 공개
            </label>

            <p className="menu-manager-help">
              전체 공개는 열람 권한만 부여합니다. 문서 작성·수정은 별도 권한이
              필요합니다.
            </p>

            <div className="menu-manager-actions">
              {selected !== null && data.can_delete && (
                <button
                  type="button"
                  className="menu-manager-danger"
                  disabled={busy}
                  onClick={() => void deleteMenu()}
                >
                  메뉴 삭제
                </button>
              )}

              <span />

              {(selected === null ? data.can_add : data.can_change) && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !form.name.trim()}
                  onClick={() => void saveMenu()}
                >
                  <Icon name="save" />
                  {busy ? "처리 중..." : "저장"}
                </button>
              )}
            </div>
            {selected !== null && (
              <MenuAccessEditor
                key={selected}
                menuId={selected}
                isPublic={
                  data.menus.find((menu) => menu.id === selected)?.is_public ??
                  false
                }
                onChanged={onChanged}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
