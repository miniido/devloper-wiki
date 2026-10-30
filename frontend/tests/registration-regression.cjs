const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output=path.resolve(__dirname,'../../docs/ui-review');
const TEST_PASSWORD='Zebra!Cloud-62-test-only';
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let loggedIn=false,role='SYSTEM_ADMIN',username='manager',failSignup=0,holdSignup=null,releaseSignup=null,holdReview=null,releaseReview=null,failReject=false;
 let submissions=[],reviews=[],registrationReads=0;
 const users=[{id:1,username:'manager',first_name:'민정',last_name:'도',roles:[],is_active:true,is_superuser:true}];
 let items=[{id:41,username:'applicant',first_name:'지수',last_name:'김',reason:'프로젝트 유지보수 가이드와 개발 자료를 열람하고 싶습니다.',status:'PENDING',requested_at:'2026-10-30T03:00:00Z',reviewed_at:null,reviewed_by:null},{id:42,username:'rejectme',first_name:'지원',last_name:'이',reason:'팀 신규 합류 신청입니다.',status:'PENDING',requested_at:'2026-10-30T02:00:00Z',reviewed_at:null,reviewed_by:null},{id:43,username:'conflict',first_name:'서준',last_name:'박',reason:'<script>not executed</script>',status:'PENDING',requested_at:'2026-10-30T01:00:00Z',reviewed_at:null,reviewed_by:null}];
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),u=url.pathname;
  const reply=(body,status=200,headers={})=>route.fulfill({status,contentType:'application/json',headers,body:JSON.stringify(body)});
  if(u==='/api/csrf/')return reply({},200,{'set-cookie':'csrftoken=test-token; Path=/; SameSite=Lax'});
  if(u==='/api/auth/me/')return loggedIn?reply({id:username==='manager'?1:2,username,role,role_label:role==='SYSTEM_ADMIN'?'관리자':'열람자',can_manage_menus:role==='SYSTEM_ADMIN'}):reply({detail:'로그인이 필요합니다.'},401);
  if(u==='/api/auth/login/'){
   const body=req.postDataJSON();
   if(body.username==='manager'||users.some(user=>user.username===body.username)) {loggedIn=true;username=body.username;role=username==='manager'?'SYSTEM_ADMIN':'VIEWER';return reply({});}
   return reply({detail:'아이디 또는 비밀번호를 확인해 주세요.'},401);
  }
  if(u==='/api/auth/logout/'){loggedIn=false;return reply({});}
  if(u==='/api/auth/registration-requests/'){
   submissions.push({body:req.postDataJSON(),csrf:req.headers()['x-csrftoken']});
   if(holdSignup)await holdSignup;
   if(failSignup===429)return reply({detail:'Throttled'},429);
   if(failSignup===400)return reply({password:['비밀번호가 너무 흔합니다.']},400);
   return reply({detail:'회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.'},202);
  }
  if(u==='/api/user-management/')return role==='SYSTEM_ADMIN'?reply({users,roles:['WIKI_ADMIN','AUTHOR','VIEWER']}):reply({detail:'금지'},403);
  if(u==='/api/menus/')return reply([{id:11,name:'Engineering',parent:null,sort_order:0,can_create:role==='SYSTEM_ADMIN',can_manage_document_access:role==='SYSTEM_ADMIN'}]);
  if(u==='/api/documents/')return reply([]);
  if(u==='/api/registration-management/'){
   registrationReads++;
   const status=url.searchParams.get('status')||'PENDING',current=Number(url.searchParams.get('page')||1);
   const filtered=items.filter(item=>status==='ALL'||item.status===status);
   return reply({count:filtered.length,next:current*25<filtered.length?'?page='+String(current+1):null,previous:current>1?'?page='+String(current-1):null,results:filtered.slice((current-1)*25,current*25)});
  }
  const review=u.match(/^\/api\/registration-management\/(\d+)\/(approve|reject)\/$/);
  if(review){const id=Number(review[1]),action=review[2];reviews.push({id,action,csrf:req.headers()['x-csrftoken']});if(holdReview)await holdReview;
   if(action==='reject'&&failReject)return reply({detail:'테스트 처리 실패'},400);
   const updated={...items.find(item=>item.id===id),status:action==='approve'?'APPROVED':'REJECTED',reviewed_at:'2026-10-30T04:00:00Z',reviewed_by:'manager'};
   items=items.map(item=>item.id===id?updated:item);
   if(id===43)return reply({detail:'이미 처리된 신청입니다.'},409);
   if(action==='approve')users.push({id:2,username:updated.username,first_name:updated.first_name,last_name:updated.last_name,is_active:true,is_superuser:false,roles:['VIEWER']});
   return reply(updated);
  }
  return reply({});
 });
 const login=async(name)=>{await page.locator('#username').fill(name);await page.locator('#password').fill(TEST_PASSWORD);await page.getByRole('button',{name:'로그인',exact:true}).click();};
 const requestTab=()=>page.getByRole('tab',{name:'가입 신청',exact:true});
 const selectRequest=(name)=>page.locator('.registration-list-item').filter({hasText:name}).click();
 await page.goto(process.env.WIKI_URL||'http://127.0.0.1:5181');
 await page.getByRole('button',{name:'회원가입 신청',exact:true}).click();await page.getByRole('heading',{name:'회원가입 신청',exact:true}).waitFor();assert.equal(await page.getByRole('combobox').count(),0);
 await page.getByRole('button',{name:'신청 제출',exact:true}).click();assert.equal(submissions.length,0);
 await page.getByLabel('아이디',{exact:false}).fill('applicant');await page.locator('#registration-last_name').fill('김');await page.locator('#registration-first_name').fill('지수');
 await page.locator('#registration-password').fill(TEST_PASSWORD);await page.locator('#registration-password_confirm').fill(TEST_PASSWORD+'wrong');await page.getByRole('button',{name:'신청 제출',exact:true}).click();await page.getByRole('alert').filter({hasText:'일치하지'}).waitFor();assert.equal(submissions.length,0);
 await page.locator('#registration-password_confirm').fill(TEST_PASSWORD);await page.locator('#registration-reason').fill('팀 개발 가이드를 확인하고 싶습니다.');
 failSignup=429;await page.getByRole('button',{name:'신청 제출',exact:true}).click();await page.getByRole('alert').filter({hasText:'신청 요청이 많습니다'}).waitFor();
 failSignup=400;await page.getByRole('button',{name:'신청 제출',exact:true}).click();await page.getByRole('alert').filter({hasText:'너무 흔합니다'}).waitFor();
 fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'registration-form.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'registration-form-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:1100});
 failSignup=0;holdSignup=new Promise(resolve=>{releaseSignup=resolve;});await page.getByRole('button',{name:'신청 제출',exact:true}).click();assert.equal(await page.getByRole('button',{name:'로그인 화면으로'}).isDisabled(),true);assert.equal(await page.locator('#registration-username').isDisabled(),true);releaseSignup();holdSignup=null;
 await page.getByRole('status').filter({hasText:'관리자 승인 후 로그인'}).waitFor();assert.equal(submissions.length,3);assert.equal(submissions[2].csrf,'test-token');assert.equal(Object.hasOwn(submissions[2].body,'role'),false);assert.equal(await page.locator('input[type=password]').count(),0);await page.screenshot({path:path.join(output,'registration-complete.png'),fullPage:true});
 await page.getByRole('button',{name:'로그인 화면으로'}).click();await login('applicant');await page.getByText('아이디 또는 비밀번호를 확인해 주세요.').waitFor();
 await login('manager');await page.getByRole('heading',{name:'팀의 기록을 한곳에.'}).waitFor();await page.getByRole('button',{name:'사용자 관리',exact:true}).click();await requestTab().click();await selectRequest('applicant');
 assert.equal(await page.locator('.registration-manager input[type=password]').count(),0);await page.screenshot({path:path.join(output,'registration-management.png'),fullPage:true});
 page.once('dialog',d=>{assert.match(d.message(),/VIEWER/);return d.dismiss();});await page.getByRole('button',{name:'승인',exact:true}).click();assert.equal(reviews.length,0);
 holdReview=new Promise(resolve=>{releaseReview=resolve;});page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'승인',exact:true}).click();assert.equal(await page.getByRole('button',{name:'거절',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('tab',{name:'전체 사용자'}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'닫기',exact:true}).isDisabled(),true);releaseReview();holdReview=null;
 await page.getByRole('status').filter({hasText:'가입을 승인'}).waitFor();assert.equal(reviews.length,1);assert.equal(reviews[0].csrf,'test-token');assert.equal(await page.locator('.registration-list-item').filter({hasText:'applicant'}).count(),0);
 await page.getByRole('tab',{name:'전체 사용자'}).click();await page.locator('.um-user').filter({hasText:'applicant'}).click();assert.equal(await page.locator('#um-role').inputValue(),'VIEWER');
 await requestTab().click();await selectRequest('rejectme');failReject=true;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'거절',exact:true}).click();await page.getByRole('alert').filter({hasText:'테스트 처리 실패'}).waitFor();assert.equal(await page.getByRole('button',{name:'거절',exact:true}).isEnabled(),true);
 failReject=false;page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'거절',exact:true}).click();await page.getByRole('status').filter({hasText:'가입 신청을 거절'}).waitFor();
 await page.getByLabel('상태',{exact:true}).selectOption('REJECTED');await selectRequest('rejectme');assert.equal(await page.getByRole('button',{name:'승인',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'거절',exact:true}).count(),0);
 await page.getByLabel('상태',{exact:true}).selectOption('PENDING');await selectRequest('conflict');assert.match(await page.locator('.registration-reason').innerText(),/<script>/);assert.equal(await page.locator('.registration-reason script').count(),0);page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'승인',exact:true}).click();await page.getByRole('alert').filter({hasText:'이미 처리된 신청'}).waitFor();await page.getByText('승인을 기다리는 신청이 없습니다.').waitFor();
 await page.getByLabel('상태',{exact:true}).selectOption('ALL');await selectRequest('applicant');await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=0);await page.locator('.registration-detail').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('.registration-manager').screenshot({path:path.join(output,'registration-management-mobile.png')});await page.setViewportSize({width:1440,height:1100});
 for(let i=0;i<26;i++)items.push({id:100+i,username:'page-member-'+i,first_name:'New',last_name:'Member',reason:'',status:'PENDING',requested_at:'2026-10-30T01:00:00Z',reviewed_at:null,reviewed_by:null});
 await page.getByLabel('상태',{exact:true}).selectOption('PENDING');await page.getByRole('button',{name:'다음',exact:true}).click();await page.getByText('2 페이지',{exact:true}).waitFor();await page.getByRole('button',{name:'이전',exact:true}).click();await page.getByText('1 페이지',{exact:true}).waitFor();
 await page.locator('.user-trigger').click();await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.locator('#username').waitFor();await login('applicant');await page.getByRole('heading',{name:'팀의 기록을 한곳에.'}).waitFor();assert.equal(await page.getByRole('button',{name:'사용자 관리',exact:true}).count(),0);
 await page.locator('.user-trigger').click();await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.locator('#username').waitFor();await login('rejectme');await page.getByText('아이디 또는 비밀번호를 확인해 주세요.').waitFor();assert.ok(registrationReads>=6);assert.deepEqual(errors,[]);
 console.log('PASS: required/matching form inputs, field/throttle errors, anonymous CSRF header, submit lock, completion and login return, approval tabs/detail, confirm cancel, review lock, VIEWER refresh, reject/retry/conflict, text escaping, pagination, mobile, approved login, rejected login and manager visibility.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
