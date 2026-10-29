export interface TreeMenu { id: number; parent: number|null; sort_order: number; name: string; }

export function sortMenusAsTree<T extends TreeMenu>(menus: T[]): { menu: T; depth: number; }[] {
  const result: { menu: T; depth: number; }[]=[];
  const visited=new Set<number>();
  const ordered=[...menus].sort((a,b) => a.sort_order-b.sort_order||a.id-b.id);
  function visit(menu: T,depth: number) {
    if(visited.has(menu.id)) return;
    visited.add(menu.id);
    result.push({ menu,depth });
    ordered.filter((item) => item.parent===menu.id).forEach((item) => visit(item,depth+1));
  }
  ordered.filter((menu) => menu.parent===null||!menus.some((item) => item.id===menu.parent)).forEach((menu) => visit(menu,0));
  ordered.forEach((menu) => visit(menu,0));
  return result;
}

export function menuAncestors<T extends TreeMenu>(menus: T[],id: number): T[] {
  const result: T[]=[];
  const visited=new Set([id]);
  let parent=menus.find((menu) => menu.id===id)?.parent;
  while(parent!=null&&!visited.has(parent)) {
    visited.add(parent);
    const menu=menus.find((item) => item.id===parent);
    if(!menu) break;
    result.unshift(menu);
    parent=menu.parent;
  }
  return result;
}
