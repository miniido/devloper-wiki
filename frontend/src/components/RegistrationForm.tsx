import { useRef, useState } from "react";
import Icon from "./Icon";
import "./Registration.css";

const EMPTY = { username: "", last_name: "", first_name: "", password: "", password_confirm: "", reason: "" };

function csrfToken() {
  return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith("csrftoken="))?.slice(10) ?? "");
}

export default function RegistrationForm({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const busyRef = useRef(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current) return;
    setError("");
    setFieldErrors({});
    if (form.password !== form.password_confirm) {
      setFieldErrors({ password_confirm: "비밀번호 확인이 일치하지 않습니다." });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const csrf = await fetch("/api/csrf/", { credentials: "same-origin" });
      if (!csrf.ok) throw new Error("보안 토큰 발급에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      const response = await fetch("/api/auth/registration-requests/", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrfToken() },
        body: JSON.stringify({ ...form, username: form.username.trim(), first_name: form.first_name.trim(), last_name: form.last_name.trim(), reason: form.reason.trim() }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 429) throw new Error("신청 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
        if (result && typeof result === "object") {
          const fields: Record<string, string> = {};
          for (const key of Object.keys(EMPTY)) {
            if (result[key]) fields[key] = Array.isArray(result[key]) ? result[key].join(" ") : String(result[key]);
          }
          setFieldErrors(fields);
          if (Object.keys(fields).length) return;
        }
        throw new Error(result?.detail || `신청을 제출하지 못했습니다. (${response.status})`);
      }
      setForm(EMPTY);
      setComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "신청 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  return <>
    <div className="login-heading"><h1>{complete ? "신청이 접수되었습니다." : "회원가입 신청"}</h1><p>{complete ? "검토가 완료될 때까지 기다려 주세요." : "팀 공간에 참여하려면 관리자 승인이 필요합니다."}</p></div>
    {complete ? <div className="registration-complete"><span className="section-icon"><Icon name="shield" /></span><p role="status">회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.</p><button className="login-submit" onClick={onBack}>로그인 화면으로</button></div> : <form className="login-form registration-form" onSubmit={submit}>
      <label htmlFor="registration-username">아이디 <span className="registration-required">필수</span></label>
      <input id="registration-username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required maxLength={150} autoComplete="username" disabled={busy} aria-invalid={!!fieldErrors.username} aria-describedby={fieldErrors.username ? "registration-username-error" : undefined} />
      {fieldErrors.username && <p id="registration-username-error" className="login-error" role="alert">{fieldErrors.username}</p>}
      <div className="registration-name-fields">{(["last_name", "first_name"] as const).map((field) => <div key={field}><label htmlFor={`registration-${field}`}>{field === "last_name" ? "성" : "이름"} <span className="registration-required">필수</span></label><input id={`registration-${field}`} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required maxLength={150} disabled={busy} autoComplete={field === "last_name" ? "family-name" : "given-name"} aria-invalid={!!fieldErrors[field]} aria-describedby={fieldErrors[field] ? `${field}-error` : undefined} />{fieldErrors[field] && <p id={`${field}-error`} className="login-error" role="alert">{fieldErrors[field]}</p>}</div>)}</div>
      {(["password", "password_confirm"] as const).map((field) => <div className="registration-password-field" key={field}><label htmlFor={`registration-${field}`}>{field === "password" ? "비밀번호" : "비밀번호 확인"} <span className="registration-required">필수</span></label><input id={`registration-${field}`} type="password" autoComplete="new-password" value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} required minLength={8} maxLength={128} disabled={busy} aria-invalid={!!fieldErrors[field]} aria-describedby={fieldErrors[field] ? `${field}-error` : field === "password" ? "registration-password-help" : undefined} />{fieldErrors[field] && <p id={`${field}-error`} className="login-error" role="alert">{fieldErrors[field]}</p>}</div>)}
      <p id="registration-password-help" className="registration-help">8자 이상으로 입력해 주세요. 아이디·이름과 비슷하거나 흔한 비밀번호, 숫자만으로 된 비밀번호는 사용할 수 없습니다.</p>
      <label htmlFor="registration-reason">신청 사유 <span className="registration-optional">선택</span></label>
      <textarea id="registration-reason" rows={3} maxLength={2000} value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} disabled={busy} placeholder="소속 팀과 사용 목적을 알려 주세요." />
      <p className="registration-help">승인 후 기본 역할은 열람자입니다. 추가 권한은 관리자가 부여합니다.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="login-submit" disabled={busy} type="submit">{busy ? "신청 중..." : "신청 제출"}</button>
      <button className="text-button registration-back" type="button" disabled={busy} onClick={onBack}>로그인 화면으로</button>
    </form>}
  </>;
}
