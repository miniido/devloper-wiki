const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../../docs/ui-review');
(async () => {
 const browser = await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'msedge'});
 try {
 const page = await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[]; page.on('pageerror',error=>errors.push(error.message));
 let manager=true, failUsers=false, failAccess=false;
 let users=[{id:1,username:'minjeong',first_name:'민정',last_name:'도',is_active:true,is_superuser:true,roles:[]},{id:2,username:'jiwon',first_name:'지원',last_name:'김',is_active:true,is_superuser:false,roles:['AUTHOR']},{id:3,username:'seojun',first_name:'서준',last_name:'이',is_active:false,is_superuser:false,roles:['VIEWER']}];
 let groups=[{group_id:1,group_name:'WIKI_ADMIN',can_view:true,can_create:true,can_edit:true},{group_id:2,group_name:'AUTHOR',can_view:true,can_create:true,can_edit:true},{group_id:3,group_name:'VIEWER',can_view:true,can_create:false,can_edit:false}];
 const menus=[{id:1,name:'개발 가이드',parent:null,sort_order:0,can_create:true,is_public:true},{id:2,name:'Backend',parent:1,sort_order:1,can_create:true,is_public:false}];
 let lastSavedGroups=null;
 await page.route('**/api/**',async route=>{
  const req=route.request(), u=new URL(req.url()).pathname;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(u==='/api/auth/me/') return reply({id:1,username:'minjeong',role:manager?'SYSTEM_ADMIN':'VIEWER',role_label:manager?'관리자':'열람자',can_manage_menus:manager});
  if(u==='/api/csrf/') return reply({});
  if(u.startsWith('/api/user-management/') && !manager) return reply({detail:'권한이 없습니다.'},403);
  if(u==='/api/user-management/') {
   if(failUsers) return reply({detail:'사용자 정보를 불러오지 못했습니다.'},500);
   if(req.method()==='POST'){const data=req.postDataJSON();const created={...data,id:4,roles:[data.role],is_active:true,is_superuser:false};users.push(created);return reply(created);}
   return reply({users,roles:['WIKI_ADMIN','AUTHOR','VIEWER']});
  }
  if(u.endsWith('/reset-password/')) return reply({detail:'변경되었습니다.'});
  if(u.startsWith('/api/user-management/')) {const id=Number(u.split('/')[3]);const data=req.postDataJSON();users=users.map(user=>user.id===id?{...user,...data,roles:[data.role]}:user);return reply(users.find(user=>user.id===id));}
  if(u==='/api/menus/') return reply(menus);
  if(u==='/api/menu-management/') return reply({menus,can_add:true,can_change:true,can_delete:true,can_manage_access:true});
  if(u.endsWith('/access/')) {
   if(failAccess) return reply({detail:'권한 조회 실패'},500);
   if(req.method()==='PUT'){lastSavedGroups=req.postDataJSON().groups;groups=groups.map(group=>({...group,...lastSavedGroups.find(g=>g.group_id===group.group_id)}));}
   return reply({menu_id:1,menu_name:'개발 가이드',is_public:true,groups});
  }
  if(u==='/api/documents/') return reply([]);
  return reply({});
 });
 await page.goto(process.env.WIKI_URL || 'http://127.0.0.1:5181');
 await page.getByRole('button',{name:'사용자 관리',exact:true}).click();
 await page.getByRole('heading',{name:'사용자 관리',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'사용자 관리',exact:true}).count(),1);
 assert.equal(await page.locator('.sidebar-home').getAttribute('class'),'sidebar-home ');
 assert.match(await page.locator('.header-breadcrumb').innerText(),/사용자 관리/);
 await page.getByLabel('사용자 검색').fill('지원');
 assert.equal(await page.locator('.um-user').count(),1);
 await page.locator('.um-user').click();
 await page.getByLabel('사용자 검색').fill('');
 await page.screenshot({path:path.join(output,'user-management.png'),fullPage:true});
 await page.getByLabel('이름',{exact:true}).fill('지원수정');
 await page.getByRole('button',{name:'변경사항 저장'}).click();
 await page.getByRole('status').filter({hasText:'저장되었습니다'}).waitFor();
 await page.locator('.um-user').filter({hasText:'minjeong'}).click();
 assert.equal(await page.getByRole('button',{name:'변경사항 저장'}).isDisabled(),true);
 assert.match(await page.locator('.um-self-info').innerText(),/본인 정보/);
 await page.getByRole('button',{name:'사용자 추가'}).click();
 await page.getByLabel('아이디',{exact:true}).fill('new-member');
 await page.getByLabel('초기 비밀번호').fill('test-only-password');
 await page.getByRole('button',{name:'사용자 생성'}).click();
 await page.getByRole('status').filter({hasText:'생성되었습니다'}).waitFor();
 await page.getByRole('button',{name:'비밀번호 변경',exact:true}).click();
 await page.getByLabel('새 비밀번호').fill('test-only-updated');
 await page.getByRole('button',{name:'취소',exact:true}).click();
 assert.equal(await page.getByLabel('새 비밀번호').count(),0);
 await page.setViewportSize({width:390,height:844});
 await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);
 await page.locator('.um-detail').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(output,'user-management-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.getByRole('button',{name:'메뉴 열기'}).click();
 await page.getByRole('button',{name:'메뉴 관리',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'메뉴 열기'}).getAttribute('aria-expanded'),'false');
 await page.locator('.menu-manager-list').getByRole('button',{name:/개발 가이드/}).click();
 await page.getByRole('checkbox',{name:'VIEWER 조회 권한'}).waitFor();
 await page.getByRole('checkbox',{name:'VIEWER 작성 권한'}).check();
 assert.equal(await page.getByRole('checkbox',{name:'VIEWER 조회 권한'}).isChecked(),true);
 await page.getByRole('checkbox',{name:'VIEWER 조회 권한'}).uncheck();
 assert.equal(await page.getByRole('checkbox',{name:'VIEWER 작성 권한'}).isChecked(),false);
 await page.getByRole('checkbox',{name:'VIEWER 조회 권한'}).check();
 await page.getByRole('checkbox',{name:'VIEWER 수정 권한'}).check();
 await page.getByRole('button',{name:'권한 저장'}).click();
 await page.getByRole('status').filter({hasText:'접근 권한이 저장'}).waitFor();
 assert.equal(lastSavedGroups.find(g=>g.group_id===3).can_create,false);
 await page.locator('.menu-access-editor').scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(output,'menu-access-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.setViewportSize({width:1440,height:1100});
 await page.locator('.main').evaluate(el=>el.scrollTop=0);
 await page.locator('.menu-access-editor').screenshot({path:path.join(output,'menu-access.png')});
 await page.getByRole('button',{name:'사용자 관리',exact:true}).click();
 await page.getByRole('button',{name:'검색 및 둘러보기',exact:true}).click();
 await page.getByRole('heading',{name:'팀의 기록을 한곳에.'}).waitFor();
 failUsers=true;await page.getByRole('button',{name:'사용자 관리',exact:true}).click();await page.getByRole('alert').waitFor();failUsers=false;
 await page.getByRole('button',{name:'메뉴 관리',exact:true}).click();failAccess=true;
 await page.locator('.menu-manager-list').getByRole('button',{name:/Backend/}).click();await page.getByRole('alert').waitFor();
 manager=false;await page.reload();await page.getByRole('heading',{name:'팀의 기록을 한곳에.'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'사용자 관리',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'메뉴 관리',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PASS: admin navigation, user search/create/update/self restrictions/password cancel, permission dependencies/save, public notice, error states, mobile layout, access visibility.');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
