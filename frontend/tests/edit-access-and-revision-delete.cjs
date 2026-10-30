const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output=path.resolve(__dirname,'../../docs/ui-review');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let role='SYSTEM_ADMIN',failSave=false,failDelete=false,holdDelete=null,releaseDelete=null;
 let nextId=79, deleteIds=[], saveBodies=[], accessWrites=0, revisionReads=0;
 const baseGroups=[{group_id:101,group_name:'WIKI_ADMIN',can_view:true,can_edit:true},{group_id:205,group_name:'AUTHOR',can_view:true,can_edit:false},{group_id:309,group_name:'VIEWER',can_view:false,can_edit:false}];
 let documents=[{id:53,menu:11,title:'Existing',content:[{type:'paragraph',content:'Existing body.'}],version:4,created_by:'manager',updated_at:'2026-10-30T03:00:00Z',use_custom_permissions:true}];
 const permissions={53:{document_id:53,title:'Existing',use_custom_permissions:true,groups:structuredClone(baseGroups)}};
 let revisions=[{id:902,version:4,title:'Existing',menu:11,changed_by:'manager',created_at:'2026-10-30T03:00:00Z',can_delete:false},{id:811,version:2,title:'Previous',menu:11,changed_by:'team',created_at:'2026-10-29T03:00:00Z',can_delete:true},{id:705,version:1,title:'Original',menu:11,changed_by:'team',created_at:'2026-10-28T03:00:00Z',can_delete:true}];
 const isManager=()=>['SYSTEM_ADMIN','WIKI_ADMIN'].includes(role);
 const serialize=doc=>({...doc,can_view:true,can_edit:role!=='VIEWER',can_manage_access:isManager(),can_delete_revisions:isManager()});
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),u=url.pathname;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:status===204?'':JSON.stringify(body)});
  if(u==='/api/auth/me/')return reply({id:1,username:'manager',role,role_label:isManager()?'관리자':'작성자',can_manage_menus:isManager()});
  if(u==='/api/csrf/')return reply({});
  if(u==='/api/user-management/')return reply({detail:'금지'},403);
  if(u==='/api/menus/')return reply([{id:11,name:'Engineering',parent:null,sort_order:0,can_create:role!=='VIEWER',can_manage_document_access:isManager()}]);
  if(u==='/api/documents/access-options/')return reply({document_id:null,title:'',use_custom_permissions:false,groups:baseGroups.map(g=>({...g,can_view:false,can_edit:false}))});
  const access=u.match(/^\/api\/documents\/(\d+)\/access\/$/);
  if(access){if(req.method()==='PUT')accessWrites++;return reply(permissions[Number(access[1])]);}
  if(u==='/api/documents/'&&req.method()==='POST'){
   const body=req.postDataJSON();saveBodies.push(body);if(failSave)return reply({detail:'테스트 문서 저장 실패'},400);
   const doc={...body,id:nextId++,version:1,created_by:'manager',updated_at:'2026-10-30T03:00:00Z',use_custom_permissions:body.use_custom_permissions??false};documents.push(doc);
   permissions[doc.id]={document_id:doc.id,title:doc.title,use_custom_permissions:doc.use_custom_permissions,groups:baseGroups.map(g=>({...g,...body.access_groups?.find(row=>row.group_id===g.group_id)}))};return reply(serialize(doc));
  }
  if(u==='/api/documents/')return reply(documents.map(serialize));
  const detail=u.match(/^\/api\/documents\/(\d+)\/$/);
  if(detail){const id=Number(detail[1]);if(req.method()==='PATCH'){const body=req.postDataJSON();saveBodies.push(body);if(failSave)return reply({detail:'테스트 문서 저장 실패'},400);documents=documents.map(d=>d.id===id?{...d,...body,version:d.version+1}:d);if(body.access_groups)permissions[id]={...permissions[id],use_custom_permissions:body.use_custom_permissions,groups:baseGroups.map(g=>({...g,...body.access_groups.find(row=>row.group_id===g.group_id)}))};}return reply(serialize(documents.find(d=>d.id===id)));}
  const deletion=u.match(/revisions\/by-id\/(\d+)\/$/);
  if(deletion){const id=Number(deletion[1]);deleteIds.push(id);if(holdDelete)await holdDelete;if(failDelete)return reply({detail:'테스트 이력 삭제 실패'},409);revisions=revisions.filter(r=>r.id!==id);return reply(null,204);}
  if(u.endsWith('/revisions/')){revisionReads++;return reply(revisions.map(r=>({...r,can_delete:isManager()&&r.version<documents[0].version&&revisions.length>1})));}
  const preview=u.match(/revisions\/(\d+)\/$/);if(preview)return reply({...revisions.find(r=>r.version===Number(preview[1])),content:[{type:'paragraph',content:'Previous preview.'}]});
  if(u.endsWith('/attachments/'))return reply([]);
  return reply({});
 });
 const menu=()=>page.getByRole('navigation',{name:'위키 메뉴'}).getByRole('button',{name:'Engineering',exact:true});
 const choose=name=>page.getByRole('button',{name,exact:true}).last();
 const custom=()=>page.getByRole('radio',{name:/문서별 권한 설정/});
 const box=(group,field)=>page.getByRole('checkbox',{name:`${group} ${field} 권한`});
 const settings=()=>page.getByRole('button',{name:/권한 설정/});
 await page.goto(process.env.WIKI_URL||'http://127.0.0.1:5181');await menu().click();await page.getByRole('button',{name:'새 문서',exact:true}).click();
 await page.getByLabel('문서 제목',{exact:true}).fill('New custom guide');
 await settings().click();await page.getByRole('radio',{name:/메뉴 권한 사용/}).waitFor();assert.equal(await page.getByRole('radio',{name:/메뉴 권한 사용/}).isChecked(),true);
 await custom().check();await box('WIKI_ADMIN','수정').check();await box('AUTHOR','조회').check();assert.equal(await box('WIKI_ADMIN','조회').isChecked(),true);
 assert.equal(saveBodies.length,0);assert.equal(accessWrites,0);
 await page.locator('.document-editor-area [contenteditable=true]').first().fill('Body kept after failed save.');
 page.once('dialog',d=>d.dismiss());await choose('Existing').click();assert.equal(await page.getByLabel('문서 제목',{exact:true}).inputValue(),'New custom guide');
 await page.getByRole('button',{name:'닫기',exact:true}).click();assert.match(await settings().innerText(),/사용자 지정/);await settings().click();assert.equal(await box('AUTHOR','조회').isChecked(),true);
 failSave=true;await page.getByRole('button',{name:'문서 저장',exact:true}).click();await page.getByRole('alert').filter({hasText:'테스트 문서 저장 실패'}).waitFor();
 assert.equal(await page.getByLabel('문서 제목',{exact:true}).inputValue(),'New custom guide');assert.equal(await box('AUTHOR','조회').isChecked(),true);assert.match(await page.locator('.document-editor-area').innerText(),/Body kept/);
 failSave=false;await page.getByRole('button',{name:'문서 저장',exact:true}).click();await page.getByRole('heading',{name:'New custom guide',exact:true}).waitFor();
 assert.equal(saveBodies.length,2);assert.equal(saveBodies[1].use_custom_permissions,true);assert.deepEqual(saveBodies[1].access_groups.map(g=>g.group_id),[101,205,309]);assert.match(JSON.stringify(saveBodies[1].content),/Body kept/);assert.equal(accessWrites,0);
 await page.getByRole('button',{name:'수정',exact:true}).click();await settings().click();await custom().waitFor();assert.equal(await custom().isChecked(),true);assert.equal(await box('AUTHOR','조회').isChecked(),true);
 await box('AUTHOR','수정').check();await page.getByLabel('문서 제목',{exact:true}).fill('Updated custom guide');
 fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'document-edit-access.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.document-access-manager').screenshot({path:path.join(output,'document-edit-access-mobile.png')});await page.setViewportSize({width:1440,height:1100});
 await page.getByRole('button',{name:'문서 저장',exact:true}).click();await page.getByRole('heading',{name:'Updated custom guide',exact:true}).waitFor();assert.equal(saveBodies.at(-1).use_custom_permissions,true);assert.equal(saveBodies.at(-1).access_groups[1].can_edit,true);
 await choose('Existing').click();await page.locator('.revision-toggle').click();await page.getByRole('button',{name:'v2 이력 삭제',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'v4 이력 삭제'}).count(),0);
 await page.locator('.revision-item').filter({hasText:'v2'}).click();await page.getByRole('heading',{name:'Previous',exact:true}).waitFor();
 page.once('dialog',d=>{assert.match(d.message(),/v2/);assert.match(d.message(),/복구할 수 없/);return d.dismiss();});await page.getByRole('button',{name:'v2 이력 삭제',exact:true}).click();assert.equal(deleteIds.length,0);
 failDelete=true;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'v2 이력 삭제',exact:true}).click();await page.getByRole('alert').filter({hasText:'테스트 이력 삭제 실패'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Previous',exact:true}).count(),1);
 failDelete=false;holdDelete=new Promise(resolve=>{releaseDelete=resolve;});page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'v2 이력 삭제',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'v1 이력 삭제',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'이 버전으로 복구',exact:true}).isDisabled(),true);releaseDelete();holdDelete=null;
 await page.getByRole('status').filter({hasText:'v2 수정 이력이 삭제'}).waitFor();assert.deepEqual(deleteIds,[811,811]);assert.equal(await page.getByRole('heading',{name:'Previous',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'v2 이력 삭제'}).count(),0);assert.ok(revisionReads>=2);
 await page.locator('.document-revision-area').scrollIntoViewIfNeeded();await page.locator('.document-revision-area').screenshot({path:path.join(output,'revision-delete.png')});
 for(const selector of ['.document-editor-area','.document-attachment-area','.document-revision-area'])assert.equal(await page.locator(selector).count(),1);
 role='AUTHOR';await page.reload();await menu().click();await choose('Existing').click();await page.getByRole('button',{name:'수정',exact:true}).click();assert.equal(await settings().count(),0);await page.getByRole('button',{name:'취소',exact:true}).click();await page.locator('.revision-toggle').click();await page.locator('.revision-item').first().waitFor();assert.equal(await page.locator('.revision-delete').count(),0);
 await page.getByRole('button',{name:'새 문서',exact:true}).click();assert.equal(await settings().count(),0);await page.getByLabel('문서 제목',{exact:true}).fill('Ordinary draft');await page.getByRole('button',{name:'문서 저장',exact:true}).click();await page.getByRole('heading',{name:'Ordinary draft',exact:true}).waitFor();assert.equal(Object.hasOwn(saveBodies.at(-1),'access_groups'),false);assert.equal(Object.hasOwn(saveBodies.at(-1),'use_custom_permissions'),false);
 assert.deepEqual(errors,[]);console.log('PASS: create/edit atomic permission payload, draft mode indicator, dependency checks, save failure preservation, unsaved leave, no separate access writes, mobile, delete confirm/cancel/failure/retry, DB-ID path, pending controls, refreshed history/selection and non-manager restrictions.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
