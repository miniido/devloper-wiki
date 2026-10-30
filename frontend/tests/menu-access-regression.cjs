const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
 try {
 const page = await browser.newPage({viewport:{width:1280,height:1000}});
 let role='SYSTEM_ADMIN', rejectSave=false, holdSave=null, releaseSave=null, holdGet=null, releaseGet=null;
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 const groups=[{group_id:101,group_name:'WIKI_ADMIN',can_view:true,can_create:true,can_edit:true},{group_id:205,group_name:'AUTHOR',can_view:true,can_create:true,can_edit:false},{group_id:309,group_name:'VIEWER',can_view:false,can_create:false,can_edit:false}];
 const state={11:structuredClone(groups),29:groups.map(g=>({...g,can_view:false,can_create:false,can_edit:false}))};
 let writes=[];
 const menus=[{id:11,name:'Engineering',parent:null,sort_order:0,is_public:true,can_create:true},{id:29,name:'Operations',parent:null,sort_order:1,is_public:false,can_create:true}];
 await page.route('**/api/**',async route=>{
  const req=route.request(), u=new URL(req.url()).pathname;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(u==='/api/auth/me/') return reply({id:1,username:'manager',role,role_label:'관리자',can_manage_menus:role!=='VIEWER'});
  if(u==='/api/csrf/') return reply({});
  if(u==='/api/user-management/') return reply({detail:'금지'},403);
  if(u==='/api/menus/') return reply(menus);
  if(u==='/api/documents/') return reply([]);
  if(u==='/api/menu-management/') return reply({menus,can_add:true,can_change:true,can_delete:true,can_manage_access:['SYSTEM_ADMIN','WIKI_ADMIN'].includes(role)});
  if(u.endsWith('/access/')) {
   const id=Number(u.split('/')[3]);
   if(req.method()==='PUT') {
    writes.push({id,body:req.postDataJSON()});
    if(holdSave) await holdSave;
    if(rejectSave) return reply({detail:'테스트 저장 실패'},400);
    state[id]=state[id].map(g=>({...g,...req.postDataJSON().groups.find(item=>item.group_id===g.group_id)}));
   } else if(id===11 && holdGet) await holdGet;
   return reply({menu_id:id,menu_name:menus.find(m=>m.id===id).name,is_public:id===11,groups:state[id]});
  }
  return reply({});
 });
 const select=name=>page.locator('.menu-manager-list').getByRole('button',{name:new RegExp(name)});
 const checkbox=(name,field)=>page.getByRole('checkbox',{name:`${name} ${field} 권한`});
 await page.goto(process.env.WIKI_URL || 'http://127.0.0.1:5181');
 await page.getByRole('button',{name:'메뉴 관리',exact:true}).click();
 await select('Engineering').click();
 await checkbox('VIEWER','조회').waitFor();
 assert.equal(await checkbox('AUTHOR','작성').isChecked(),true);
 assert.match(await page.locator('.menu-access-info').innerText(),/비공개 메뉴로 변경/);
 assert.match(await page.locator('.menu-access-hint').innerText(),/전역 모델 권한/);
 await checkbox('VIEWER','작성').check();
 assert.equal(await checkbox('VIEWER','조회').isChecked(),true);
 assert.equal(writes.length,0);
 page.once('dialog',d=>d.dismiss());await select('Operations').click();
 assert.equal(await page.getByLabel('메뉴 이름',{exact:true}).inputValue(),'Engineering');
 assert.equal(await checkbox('VIEWER','작성').isChecked(),true);
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'검색 및 둘러보기'}).click();
 assert.equal(await page.locator('.menu-access-editor').count(),1);
 await checkbox('VIEWER','조회').uncheck();
 assert.equal(await checkbox('VIEWER','작성').isChecked(),false);
 assert.equal(await page.getByRole('button',{name:'권한 저장'}).isDisabled(),true);
 await checkbox('VIEWER','수정').check();
 page.once('dialog',d=>d.accept());await select('Operations').click();
 await page.waitForFunction(()=>document.querySelector('[aria-label="WIKI_ADMIN 조회 권한"]')?.checked===false);
 assert.equal(await checkbox('VIEWER','수정').isChecked(),false);
 assert.equal(await page.locator('.menu-access-info').count(),0);
 assert.equal(writes.length,0);
 // A late Engineering GET must never overwrite Operations.
 holdGet=new Promise(resolve=>{releaseGet=resolve;});
 await select('Engineering').click();
 await page.getByText('권한 정보를 불러오는 중...').waitFor();
 await select('Operations').click();
 await checkbox('AUTHOR','조회').waitFor();
 releaseGet();holdGet=null;
 assert.equal(await checkbox('AUTHOR','조회').isChecked(),false);
 // Retry a failed save without losing local changes.
 await checkbox('VIEWER','수정').check();rejectSave=true;
 await page.getByRole('button',{name:'권한 저장'}).click();
 await page.getByRole('alert').filter({hasText:'테스트 저장 실패'}).waitFor();
 assert.equal(await checkbox('VIEWER','수정').isChecked(),true);
 assert.equal(await page.getByRole('button',{name:'권한 저장'}).isEnabled(),true);
 rejectSave=false;holdSave=new Promise(resolve=>{releaseSave=resolve;});
 await page.getByRole('button',{name:'권한 저장'}).click();
 await page.getByRole('button',{name:'저장 중...'}).waitFor();
 assert.equal(await select('Engineering').isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'닫기',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'검색 및 둘러보기'}).click();
 assert.equal(await page.locator('.menu-access-editor').count(),1);
 assert.equal(writes.length,2);
 releaseSave();holdSave=null;
 await page.getByRole('status').filter({hasText:'접근 권한이 저장'}).waitFor();
 assert.equal(writes.length,2);
 assert.equal(writes[1].id,29);
 assert.deepEqual(writes[1].body.groups.map(g=>g.group_id),[101,205,309]);
 assert.equal(writes[1].body.groups[2].can_view,true);
 assert.equal(writes[1].body.groups[2].can_edit,true);
 await select('Engineering').click();await checkbox('VIEWER','조회').waitFor();
 assert.equal(await checkbox('VIEWER','조회').isChecked(),false);
 await select('Operations').click();await checkbox('VIEWER','조회').waitFor();
 assert.equal(await checkbox('VIEWER','수정').isChecked(),true);
 // A model permission alone is not enough to expose the access editor.
 role='AUTHOR';await page.reload();await page.getByRole('button',{name:'메뉴 관리',exact:true}).click();await select('Engineering').click();
 assert.equal(await page.locator('.menu-access-editor').count(),0);
 role='VIEWER';await page.reload();await page.getByRole('heading',{name:'팀의 기록을 한곳에.'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'메뉴 관리',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: capability gate, GET state, local-only changes, discard cancel/accept, external navigation guard, reverted dirty state, delayed GET isolation, failed save retry, in-flight navigation/duplicate prevention, dynamic IDs and persisted selection.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
