import { useEffect,useRef,useState } from "react";
import Icon from "./Icon";
export default function UserMenu({ user,onLogout }: { user: { username: string; role_label: string; }; onLogout: () => Promise<void>; }) {
  const [open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  useEffect(() => {
    function close(event: PointerEvent) { if(!ref.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if(event.key==="Escape") { setOpen(false); ref.current?.querySelector("button")?.focus(); } }
    document.addEventListener("pointerdown",close);
    document.addEventListener("keydown",escape);
    return () => { document.removeEventListener("pointerdown",close); document.removeEventListener("keydown",escape); };
  },[]);
  return <div className="user-menu" ref={ref} onBlur={(event) => { if(!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button className="user-trigger" aria-expanded={open} aria-controls="user-actions" onClick={() => setOpen(!open)}><span className="user-avatar">{user.username.slice(0,2).toUpperCase()}</span><span className="user-info"><strong>{user.username}</strong><small>{user.role_label}</small></span><Icon name="chevron" className="user-chevron" /></button>
    {open&&<div className="user-dropdown" id="user-actions"><p>{user.username}<small>{user.role_label}</small></p><button onClick={() => { setOpen(false); void onLogout(); }}><Icon name="logout" />로그아웃</button></div>}
  </div>;
}
