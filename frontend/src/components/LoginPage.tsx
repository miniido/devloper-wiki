import { useState } from "react";

interface LoginPageProps {
  onLogin: () => Promise<void>;
}

function getCsrfToken() {
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith("csrftoken="));

  return cookie
    ? decodeURIComponent(cookie.substring("csrftoken=".length))
    : "";
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // 로그인 전 CSRF 쿠키 확보
      const csrfResponse = await fetch("/api/csrf/", {
        credentials: "same-origin",
      });

      if (!csrfResponse.ok) {
        throw new Error("로그인 준비에 실패했습니다.");
      }

      const response = await fetch("/api/auth/login/", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken(),
        },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || "로그인에 실패했습니다.");
      }

      // 로그인 시 CSRF 토큰이 갱신되므로 다시 확보
      const refreshedCsrf = await fetch("/api/csrf/", {
        credentials: "same-origin",
      });

      if (!refreshedCsrf.ok) {
        throw new Error("로그인 후 보안 토큰 갱신에 실패했습니다.");
      }

      await onLogin();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "로그인 오류가 발생했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-panel">
        <div className="login-brand">
          <span className="brand-mark">D.</span>
          <span>Developer Wiki</span>
        </div>

        <div className="login-heading">
          <h1>다시 오신 것을 환영합니다.</h1>
          <p>팀의 개발 기록을 이어서 확인해 보세요.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="username">아이디</label>
          <input
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            placeholder="아이디를 입력하세요"
          />

          <label htmlFor="password">비밀번호</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            placeholder="비밀번호를 입력하세요"
          />

          {error && <p className="login-error">{error}</p>}

          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <p className="login-footer">사내 개발자 전용 서비스</p>
      </div>
    </div>
  );
}
