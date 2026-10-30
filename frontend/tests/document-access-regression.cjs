const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname,'../../docs/ui-review');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let role='SYSTEM_ADMIN',failGet=false,failPut=false,holdPut=null,releasePut=null,rights='normal',nextRights='normal';
 const writes=[],reads=[];
 const initial=[{group_id:101,group_name:'WIKI_ADMIN',can_view:true,can_edit:true},{group_id:209,group_name:'AUTHOR',can_view:true,can_edit:false},{group_id:307,group_name:'VIEWER',can_view:false,can_edit:false}];
 const access={53:{document_id:53,title:'Alpha',use_custom_permissions:false,groups:structuredClone(initial)},79:{document_id:79,title:'Beta',use_custom_permissions:false,groups:initial.map(g=>({...g,can_view:false,can_edit:false}))}};
 function doc(id){return {id,menu:11,title:id===53?'Alpha':'Beta',version:1,created_by:'team',updated_at:'2026-10-30T03:00:00Z',content:[{type:'paragraph',content:'Document access regression content.'}],can_edit:role!=='VIEWER'&&rights!=='readonly',can_manage_access:['SYSTEM_ADMIN','WIKI_ADMIN'].includes(role)&&rights==='normal',use_custom_permissions:access[id].use_custom_permissions};}
 await page.route('**/api/**',async route=>{
  const req=route.request(),u=new URL(req.url()).pathname;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(u==='/api/auth/me/')return reply({id:1,username:'manager',role,role_label:'관리자',can_manage_menus:['SYSTEM_ADMIN','WIKI_ADMIN'].includes(role)});
  if(u==='/api/csrf/')return reply({});
  if(u==='/api/user-management/')return reply({detail:'금지'},403);
  if(u==='/api/menus/')return reply([{id:11,name:'Engineering',parent:null,sort_order:0,can_create:role!=='VIEWER'}]);
  if(u==='/api/documents/')return reply((rights==='hidden'?[79]:[53,79]).map(doc));
  const match=u.match(/^\/api\/documents\/(\d+)\/access\/$/);
  if(match){const id=Number(match[1]);
   if(req.method()==='GET'){reads.push(id);if(failGet)return reply({detail:'테스트 조회 실패'},500);return reply(access[id]);}
   writes.push({id,body:req.postDataJSON()});if(holdPut)await holdPut;if(failPut)return reply({detail:'테스트 저장 실패'},400);
   access[id]={...access[id],...req.postDataJSON(),groups:access[id].groups.map(g=>({...g,...req.postDataJSON().groups.find(r=>r.group_id===g.group_id)}))};rights=nextRights;return reply(access[id]);
  }
  const detail=u.match(/^\/api\/documents\/(\d+)\/$/);
  if(detail){if(rights==='hidden')return reply({detail:'없음'},404);return reply(doc(Number(detail[1])));}
  if(u.endsWith('/attachments/')||u.endsWith('/revisions/'))return reply([]);
  return reply({});
 });
 const select=name=>page.getByRole('button',{name,exact:true}).last();
 const panel=()=>page.getByRole('region',{name:'문서 접근 권한'});
 const custom=()=>page.getByRole('radio',{name:/문서별 권한 설정/});
 const inherited=()=>page.getByRole('radio',{name:/메뉴 권한 사용/});
 const box=(group,field)=>page.getByRole('checkbox',{name:`${group} ${field} 권한`});
 const save=()=>page.getByRole('button',{name:'문서 권한 저장',exact:true});
 const open=async name=>{await select(name).click();await page.getByRole('heading',{name,exact:true}).waitFor();};
 const openPanel=async()=>{await page.getByRole('button',{name:'접근 권한',exact:true}).click();await inherited().waitFor();};
 await page.goto(process.env.WIKI_URL||'http://127.0.0.1:5181');
 await page.getByRole('navigation',{name:'위키 메뉴'}).getByRole('button',{name:'Engineering',exact:true}).click();
 await open('Alpha');await openPanel();
 assert.equal(await inherited().isChecked(),true);assert.equal(await panel().getByRole('table').count(),0);
 await custom().check();assert.equal(await box('AUTHOR','조회').isChecked(),true);
 await box('VIEWER','수정').check();assert.equal(await box('VIEWER','조회').isChecked(),true);assert.equal(writes.length,0);
 page.once('dialog',d=>d.dismiss());await select('Beta').click();assert.equal(await page.getByRole('heading',{name:'Alpha',exact:true}).count(),1);
 page.once('dialog',d=>d.dismiss());await panel().getByRole('button',{name:'닫기'}).click();assert.equal(await panel().count(),1);
 page.once('dialog',d=>d.accept());await open('Beta');assert.equal(await panel().count(),0);await openPanel();await custom().check();assert.equal(await box('AUTHOR','조회').isChecked(),false);
 await inherited().check();assert.equal(await save().isDisabled(),true);
 await open('Alpha');failGet=true;await page.getByRole('button',{name:'접근 권한',exact:true}).click();await page.getByRole('alert').filter({hasText:'테스트 조회 실패'}).waitFor();failGet=false;
 await page.getByRole('button',{name:'다시 불러오기'}).click();await inherited().waitFor();await custom().check();
 await box('VIEWER','수정').check();await box('VIEWER','조회').uncheck();assert.equal(await box('VIEWER','수정').isChecked(),false);await box('VIEWER','수정').check();
 failPut=true;await save().click();await page.getByRole('alert').filter({hasText:'테스트 저장 실패'}).waitFor();assert.equal(await box('VIEWER','수정').isChecked(),true);
 failPut=false;holdPut=new Promise(resolve=>{releasePut=resolve;});await save().click();await page.getByRole('button',{name:'저장 중...'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'수정',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'검색 및 둘러보기'}).click();assert.equal(await panel().count(),1);
 releasePut();holdPut=null;await page.getByRole('status').filter({hasText:'문서 접근 권한이 저장'}).waitFor();
 assert.equal(writes.length,2);assert.deepEqual(writes[1].body.groups.map(g=>g.group_id),[101,209,307]);assert.equal(writes[1].id,53);
 assert.equal(await page.locator('.document-access-badge').innerText(),'CUSTOM');
 for(const selector of ['.document-editor-area','.document-attachment-area','.document-revision-area'])assert.equal(await page.locator(selector).count(),1);
 await panel().getByRole('button',{name:'닫기'}).click();await openPanel();assert.equal(await custom().isChecked(),true);assert.equal(await box('VIEWER','수정').isChecked(),true);
 await inherited().check();await save().click();await page.getByRole('status').filter({hasText:'문서 접근 권한이 저장'}).waitFor();assert.equal(access[53].groups[2].can_edit,true);
 await custom().check();assert.equal(await box('VIEWER','수정').isChecked(),true);await save().click();await page.getByRole('status').filter({hasText:'문서 접근 권한이 저장'}).waitFor();
 fs.mkdirSync(output,{recursive:true});await panel().screenshot({path:path.join(output,'document-access.png')});
 await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);await panel().scrollIntoViewIfNeeded();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await panel().screenshot({path:path.join(output,'document-access-mobile.png')});
 await page.setViewportSize({width:1440,height:1100});nextRights='readonly';await box('AUTHOR','수정').check();await save().click();
 await page.waitForFunction(()=>!document.querySelector('.document-access-manager'));
 assert.equal(await page.getByRole('button',{name:'수정',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'접근 권한',exact:true}).count(),0);
 rights='normal';nextRights='hidden';await page.reload();await page.getByRole('navigation',{name:'위키 메뉴'}).getByRole('button',{name:'Engineering',exact:true}).click();await open('Alpha');await openPanel();await inherited().check();await save().click();
 await page.getByRole('alert').filter({hasText:'더 이상 열람'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Alpha',exact:true}).count(),0);assert.equal(await page.locator('.document-editor-area').count(),0);
 for(const member of ['AUTHOR','VIEWER']){role=member;rights='normal';await page.reload();await page.getByRole('navigation',{name:'위키 메뉴'}).getByRole('button',{name:'Engineering',exact:true}).click();await open('Alpha');assert.equal(await page.getByRole('button',{name:'접근 권한',exact:true}).count(),0);}
 assert.deepEqual(errors,[]);console.log('PASS: document modes, permission dependencies, local state, discard/close guards, per-document isolation, GET retry, PUT retry/lock, dynamic IDs, settings retention, refresh after lost edit/view, wrappers, mobile and hidden controls.');
 } finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
