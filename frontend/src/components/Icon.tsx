const paths={
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  shield: "M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7ZM8 12l3 3 5-6",
  lock: "M5 10h14v11H5ZM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
  edit: "m16 3 5 5M4 20l4-1L21 6a2.1 2.1 0 0 0-3-3L5 16l-1 4ZM4 20h16",
  close: "m6 6 12 12M6 18 18 6",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8",
  menu: "M4 6h16M4 12h16M4 18h16",chevron: "m9 5 7 7-7 7",
  folder: "M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11H3Z",
  folderOpen: "M3 10V5h7l2 3h9l-3 11H3V10h18",
  file: "M14 3H5v18h14V8ZM14 3v5h5M8 13h8M8 17h5",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14M5 12h14",settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M20 21v-2a4 4 0 0 0-3-4M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M17 3a4 4 0 0 1 0 8",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  image: "M3 3h18v18H3ZM3 17l6-6 5 5 3-3 4 4M16 7h.01",
  code: "m8 8-4 4 4 4m8-8 4 4-4 4M14 4l-4 16",
  history: "M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2",
  paperclip: "m21 11-9 9a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 0 1-2.8-2.8l9-9",
  archive: "M3 4h18v5H3ZM5 9v12h14V9M10 13h4",
  logout: "M9 3H3v18h6M9 12h12m-4-4 4 4-4 4",
} as const;
export default function Icon({ name,className="" }: { name: keyof typeof paths; className?: string; }) {
  return <svg className={`icon ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
