const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../../docs/ui-review');
fs.mkdirSync(output, { recursive: true });
(async () => {
 const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
 const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 let role = 'SYSTEM_ADMIN';
 const menus = [{id:1,name:'개발 가이드',parent:null,sort_order:0,can_create:true},{id:2,name:'Backend',parent:1,sort_order:0,can_create:true},{id:3,name:'Django',parent:2,sort_order:0,can_create:true},{id:4,name:'프로젝트 기록',parent:null,sort_order:1,can_create:false}];
 let doc = {id:1,menu:3,title:'Django API 개발 가이드',created_by:'minjeong',updated_at:'2026-10-29T03:20:00Z',can_edit:true,version:2,content:[{type:'heading',props:{level:2},content:'일관된 API를 위한 팀의 약속'},{type:'paragraph',content:'새로운 프로젝트를 시작할 때 함께 확인하는 개발 가이드입니다. 작은 결정도 기록으로 남겨 팀의 다음 작업을 더 쉽게 만듭니다.'},{type:'heading',props:{level:3},content:'시작하기'},{type:'paragraph',content:'Django Session과 CSRF 인증을 사용합니다. 모든 문서는 메뉴와 문서별 접근 권한을 확인한 뒤 제공됩니다.'},{type:'bulletListItem',content:'새 API는 기존 권한 정책을 확인하고 구현합니다.'},{type:'bulletListItem',content:'변경 사항은 테스트와 함께 기록합니다.'}]};
 const revisions = [{id:2,version:2,title:doc.title,menu:3,changed_by:'minjeong',created_at:doc.updated_at},{id:1,version:1,title:'이전 개발 가이드',menu:3,changed_by:'team',created_at:'2026-10-28T03:20:00Z'}];
 let attachments = [{id:1,name:'API-checklist.pdf',size:24800,download_url:'/api/attachments/1/download/'}];
 const requests=[];
 await page.route('**/api/**', async route => {
  const req=route.request(); const url=new URL(req.url()); const u=url.pathname; requests.push(`${req.method()} ${u}`);
  let body={};
  if(u==='/api/auth/me/') body={id:1,username:'minjeong',role,role_label:role==='SYSTEM_ADMIN'?'관리자':role==='AUTHOR'?'작성자':'열람자',can_manage_menus:role==='SYSTEM_ADMIN'};
  else if(u==='/api/user-management/') { if(role!=='SYSTEM_ADMIN') return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({detail:'접근 권한이 없습니다.'})}); body={users:[],roles:['WIKI_ADMIN','AUTHOR','VIEWER']}; }
  else if(u.endsWith('/access/')) body={menu_id:3,menu_name:'Django',is_public:true,groups:[]};
  else if(u==='/api/menus/') body=menus.map(m=>({...m,can_create:role==='VIEWER'?false:m.can_create}));
  else if(u==='/api/menu-management/') body={can_add:true,can_change:true,can_delete:true,can_manage_access:true,menus:menus.map(m=>({...m,is_public:true}))};
  else if(u.includes('/revisions/') && u.endsWith('/restore/')) {doc={...doc,title:'이전 개발 가이드',version:3};body={version:3};}
  else if(u.includes('/revisions/1/')) body={...revisions[1],content:[{type:'paragraph',content:'이전 버전 본문'}]};
  else if(u.includes('/revisions/')) body=u.endsWith('/revisions/')?revisions:{...revisions[0],content:doc.content};
  else if(u.endsWith('/attachments/')) {if(req.method()==='POST') attachments.push({id:2,name:'test.txt',size:4,download_url:'/api/attachments/2/download/'});body=req.method()==='POST'?attachments.at(-1):attachments;}
  else if(u==='/api/documents/1/') {if(req.method()==='PATCH') doc={...doc,...req.postDataJSON(),version:doc.version+1};body={...doc,can_edit:role!=='VIEWER'};}
  else if(u==='/api/documents/') { if(req.method()==='POST') {doc={...doc,...req.postDataJSON(),id:2,version:1};body=doc;} else body=url.searchParams.has('q')?[{...doc,can_edit:role!=='VIEWER'}]:url.searchParams.get('menu')==='3'?[{...doc,can_edit:role!=='VIEWER'}]:[]; }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
 });
 const menu=name=>page.getByRole('navigation',{name:'위키 메뉴'}).getByRole('button',{name,exact:true});
 await page.goto(process.env.WIKI_URL || 'http://localhost:5174');
 await page.getByRole('heading',{name:'팀의 기록을 한곳에.'}).waitFor();
 await page.screenshot({path:path.join(output,'workspace-home.png'),fullPage:true});
 await page.getByRole('button',{name:'새 문서',exact:true}).click();
 assert.match(await page.getByRole('alert').innerText(), /먼저 선택/);
 for(let i=0;i<6;i++){await menu('개발 가이드').click();assert.equal(await menu('Backend').isVisible(),i%2===0);}
 await menu('개발 가이드').click(); await menu('Backend').click(); await menu('Django').click();
 await page.getByRole('button',{name:'Django API 개발 가이드'}).last().click();
 await page.locator('.document-editor-area .bn-editor').waitFor();
 assert.equal(await page.locator('.document-attachment-area').count(),1);
 assert.equal(await page.locator('.document-revision-area').count(),1);
 assert.equal(await page.locator('.revision-toggle').getAttribute('aria-expanded'),'false');
 await page.screenshot({path:path.join(output,'document-desktop.png'),fullPage:true});
 await page.locator('.revision-toggle').click(); await page.getByRole('button',{name:/v1/}).click();
 await page.getByRole('heading',{name:'이전 개발 가이드'}).waitFor();
 await page.screenshot({path:path.join(output,'revision-preview.png'),fullPage:true});
 assert.equal(await page.locator('.revision-preview [contenteditable=true]').count(),0);
 page.on('dialog',d=>d.accept()); await page.getByRole('button',{name:'이 버전으로 복구',exact:true}).click();
 await page.getByRole('heading',{name:'이전 개발 가이드',exact:true}).waitFor();
 await page.getByRole('button',{name:'수정',exact:true}).click();
 await page.screenshot({path:path.join(output,'document-edit.png'),fullPage:true});
 await page.getByLabel('문서 제목',{exact:true}).fill('변경한 가이드');
 await page.getByRole('button',{name:'문서 저장',exact:true}).click();
 await page.getByRole('heading',{name:'변경한 가이드'}).waitFor();
 for(let i=0;i<3;i++){await menu('프로젝트 기록').click();assert.equal(await page.getByRole('button',{name:'새 문서',exact:true}).isDisabled(),true);await menu('Django').click();await page.getByRole('button',{name:'변경한 가이드'}).last().click();await page.locator('.document-editor-area .bn-editor').waitFor();assert.equal(await page.locator('.attachment-section').count(),1);assert.equal(await page.locator('.revision-history').count(),1);}
 await page.getByRole('button',{name:'minjeong 관리자'}).click();await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor(); await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'로그아웃',exact:true}).count(),0);
 await page.getByRole('button',{name:'메뉴 관리',exact:true}).click();
 await page.getByRole('heading',{name:'메뉴 관리',exact:true}).waitFor();
 await page.locator('.menu-manager-list').getByRole('button',{name:/Django/}).click();
 assert.equal(await page.locator('.menu-manager-list > button.active').evaluate(el=>el.style.paddingLeft),'48px');
 await page.screenshot({path:path.join(output,'menu-management.png'),fullPage:true});
 await page.getByRole('button',{name:'닫기',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 0);
 await page.screenshot({path:path.join(output,'document-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.getByRole('button',{name:'메뉴 열기'}).click();assert.equal(await menu('Django').isVisible(),true);
 for(const r of ['AUTHOR','VIEWER']) {role=r; await page.reload();await page.getByRole('heading',{name:'팀의 기록을 한곳에.'}).waitFor();assert.equal(await page.getByRole('button',{name:'메뉴 관리',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/사용자 관리/}).count(),0);}
 assert.equal(requests.some(r=>r.includes('/users/')),false);
 assert.deepEqual(errors,[]);
 console.log('PASS: repeated expansion, 3-level navigation, create guidance, read-only creation guard, editor save, restore preview, wrapper uniqueness, account dropdown, admin visibility, menu depth, mobile overflow. Screenshots: docs/ui-review');
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});

