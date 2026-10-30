const labels: Record<string, string> = {
  SYSTEM_ADMIN: "시스템 관리자",
  WIKI_ADMIN: "위키 관리자",
  AUTHOR: "작성자",
  VIEWER: "열람자",
};
export function roleLabel(role: string): string {
  return labels[role] ?? role;
}
