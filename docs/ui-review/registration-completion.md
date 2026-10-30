# 관리자 승인형 회원가입 구현 결과

## 1. 수정·추가 파일

- `backend/wiki/models.py`: RegistrationRequest 모델 추가. 기존 User/문서/권한 모델은 유지합니다.
- `backend/wiki/migrations/0009_registrationrequest.py`: 신청 테이블, 대기 중 아이디 unique 제약, 처리 상태/비밀번호 해시 정리 check 제약, 상태·신청일 인덱스.
- `backend/wiki/registration_views.py` (추가): 공개 신청·CSRF·입력 검증·빈도 제한, 관리자 목록·승인·거절 API.
- `backend/wiki/urls.py`: 위 API 등록.
- `backend/wiki/test_registration.py` (추가): 회원가입/승인/보안/동시성 테스트 21개.
- `backend/wiki/test_document_access.py`, `backend/wiki/tests.py`: PostgreSQL 회귀 검사에서 발견한 기존 파일 응답 테스트 종료 방식 수정. 수동 response.close 대신 Django 테스트 클라이언트의 streaming_content를 소비해 테스트 트랜잭션 DB 연결이 닫히지 않게 했습니다. 제품 권한 코드는 변경하지 않았습니다.
- `frontend/src/components/LoginPage.tsx`: 회원가입 신청 버튼과 기존 로그인 화면 복귀.
- `frontend/src/components/RegistrationForm.tsx`, `Registration.css` (추가): 신청 폼, 필수/비밀번호 확인/서버 오류, 처리 중 잠금, 완료 안내.
- `frontend/src/components/UserManager.tsx`: 전체 사용자/가입 신청 탭. 기존 사용자 폼과 user Props는 유지합니다.
- `frontend/src/components/RegistrationManager.tsx`, `RegistrationManager.css` (추가): 대기·처리 내역 목록, 상태 필터/페이지 이동, 상세, 승인·거절 확인·재조회, 사용자 목록 갱신.
- `frontend/tests/registration-regression.cjs` (추가): 신청 및 관리자 검토 화면·기존 로그인 회귀 검사와 캡처.

## 2. DB 모델 및 마이그레이션

신청 시 Django User를 생성하지 않습니다. username, first_name, last_name, password_hash, reason, status, requested_at, reviewed_at, reviewed_by를 별도 테이블에 보관합니다.

- 비밀번호는 검증 직후 Django make_password로 해싱합니다. password/password_confirm 필드와 IP 주소를 신청 테이블에 저장하지 않습니다.
- PENDING은 비어 있지 않은 해시와 미처리 상태를 요구합니다. APPROVED/REJECTED는 해시가 비어 있고 처리 관리자·일시가 있어야 합니다. DB check 제약으로도 검증합니다.
- 동일 username의 PENDING은 최대 하나입니다. User의 기존 username unique 제약과 승인 시 행 잠금을 함께 사용합니다.
- username의 대소문자 취급은 기존 Django User 정책을 유지하며 공백 제거/NFKC 정규화와 기존 username validator를 적용합니다.
- reviewed_by는 PROTECT여서 처리 이력을 가진 관리자 계정 삭제 시 감사 기록이 무너지지 않습니다.

`0009_registrationrequest`는 메모리 SQLite 및 독립 PostgreSQL 테스트 DB에서 적용했고, **실제 개발 PostgreSQL DB에도 적용 완료**했습니다. showmigrations에서 `[X] 0009_registrationrequest`를 확인했습니다. 개발 계정·문서·첨부파일·기존 그룹 권한은 변경하지 않았습니다.

## 3. API 목록

- `POST /api/auth/registration-requests/`: 비로그인 신청. CSRF 토큰 필요. 유효한 신청은 202 및 공통 완료 안내.
- `GET /api/registration-management/`: 기존 사용자 관리 자격이 있는 관리자만 목록 조회. 기본 PENDING, status=PENDING/APPROVED/REJECTED/ALL 필터. page/page_size 지원(기본 25, 최대 100).
- `POST /api/registration-management/{id}/approve/`: 승인.
- `POST /api/registration-management/{id}/reject/`: 거절.

공개 상태 조회 API는 MVP에서 생략했습니다. 아이디만으로 신청 상태나 존재 여부를 알아낼 수 없습니다.

신청 JSON 필드: username, first_name, last_name, password, password_confirm, reason(선택). 역할/관리자 플래그 등 알 수 없는 필드는 400으로 거부합니다.

## 4. 승인·거절과 중복 정책

기존 `user_management_views.is_manager`를 재사용하여 활성 Superuser 또는 WIKI_ADMIN만 목록/처리에 접근합니다. AUTHOR/VIEWER와 staff 플래그만 가진 사용자는 403입니다.

승인은 하나의 트랜잭션에서 신청 행 select_for_update → PENDING 확인 → User 중복 재확인 → 기존 VIEWER 그룹 확인 → User 생성 → 신청 해시를 User.password에 그대로 안전하게 복사 → VIEWER만 부여 → APPROVED 및 처리 정보 기록 → 신청 해시 제거 순으로 실행합니다. 비밀번호 해시를 다시 set_password로 이중 해싱하지 않습니다. User는 active=True, staff=False, superuser=False입니다.

- 기존 VIEWER 그룹이 없으면 409이며 계정을 만들지 않습니다. 권한 그룹을 임의로 만들거나 전역 권한을 새로 부여하지 않습니다.
- 이미 처리한 신청은 409입니다. 승인 후 거절/재승인도 불가합니다.
- 계정 중복 충돌 시 User unique 제약과 IntegrityError 처리로 중복 생성을 막고 409를 반환합니다.
- 거절도 동일 행 잠금/트랜잭션을 사용하며 상태·처리자·처리일 기록과 해시 제거를 함께 처리합니다.
- 거절 후에는 새 신청이 가능합니다. 이전 REJECTED 이력을 보존하고 새 PENDING을 만들며, 과거 신청을 덮어쓰지 않습니다.
- 공개 API의 기존 계정·중복 PENDING 요청에는 신규와 **같은 202/같은 문구**를 반환하되 기존 계정·신청은 변경하지 않습니다. 이 응답은 아이디 사용 가능 여부를 확인해 주지 않습니다.

## 5. 공개 엔드포인트 보호

- 별도 SessionAuthentication이 익명 POST에도 CSRF를 강제합니다. 기존 로그인/로그아웃 인증 방식은 바꾸지 않았습니다.
- JSON 본문 최대 16 KiB, 아이디/성/이름 최대 150자, 비밀번호/확인 최대 128자, 사유 최대 2000자. 필수·문자열 타입·제어 문자/잘못된 Unicode·비밀번호 확인·Django 비밀번호 validator를 검사합니다.
- 기본 접속 주소당 시간 창별 5회/시간, 20회/일입니다. `REGISTRATION_REQUESTS_PER_HOUR`, `REGISTRATION_REQUESTS_PER_DAY` 설정으로 조정할 수 있습니다.
- 캐시의 add/incr를 이용하며 캐시 키에는 HMAC 주소 식별자를 사용합니다. 클라이언트가 보낸 임의 X-Forwarded-For는 신뢰하지 않습니다. 잘못된 신청도 시도 횟수에 포함됩니다.
- 제한 초과는 429/Retry-After이며 제한 저장소 장애 시에도 무제한 허용하지 않습니다. DB 장애는 신청 본문을 출력하지 않는 일반 503 안내로 처리합니다.
- 공개/관리자 응답에 password/password_hash를 직렬화하지 않습니다. 코드에서 평문 비밀번호를 로깅하지 않으며 민감 변수는 Django 오류 보고 필터 대상입니다.
- 브라우저 localStorage/sessionStorage에 비밀번호를 저장하지 않습니다. 완료 및 로그인 화면 복귀 시 폼의 비밀번호를 폐기합니다.

## 6. 빌드 및 테스트 결과

- npm run build (TypeScript 포함): 통과. 기존 BlockNote 번들 크기 경고는 남아 있습니다.
- npm run lint: 통과.
- python manage.py check: 통과.
- makemigrations --check --dry-run: No changes detected.
- migrate: 실제 개발 PostgreSQL의 0009 적용 완료 및 showmigrations 재확인.
- SQLite 전체: 76개 중 75개 통과, PostgreSQL 동시성 전용 1개는 명시적으로 skip.
- **독립 임시 PostgreSQL DB 전체: 76개 모두 통과, skip 없음.** 동시 승인 두 요청이 200/409로 끝나고 계정이 하나만 생성되는 것을 검증했습니다. 고유 테스트 DB만 생성/제거했으며 개발 DB를 테스트 데이터로 사용하지 않았습니다.
- 브라우저 검사 6종: registration-regression, edit-access-and-revision-delete, document-access-regression, menu-access-regression, admin-ui-regression, ui-regression 모두 통과.
- git diff --check: 통과.

주요 신규 검증: 익명 신청/CSRF, User 미생성, 해시만 저장, 승인 후 VIEWER 로그인, 승인·거절 후 해시 제거, 역할별 403, 중복 신청 공통 응답 및 기존 데이터 보존, 중복 승인, 거절 후 재신청·로그인 불가, DB unique/check 제약, 트랜잭션 롤백, VIEWER 미설정/계정 충돌, 입력·본문 크기 제한, 시간/일 요청 제한 및 XFF 우회 차단, DB/제한 저장소 장애, 관리자 목록 비밀번호 비노출, 동시 승인, UI 확인/취소·실패 재시도·상태 필터·페이지·모바일·완료 화면·기존 사용자 목록 갱신.

최초 PostgreSQL 전체 실행은 기존 파일 응답 테스트가 DB 연결을 직접 닫아 연쇄 실패했습니다. 테스트의 스트리밍 응답 소비 방식을 고친 뒤 전체 76개가 통과했습니다. 제품의 파일 다운로드·권한 판정 코드를 우회하거나 변경한 것은 아닙니다.

브라우저 검사는 실제 React/BlockNote UI에 테스트용 API 응답을 연결한 것이며 실제 개발 계정을 만들거나 실제 신청을 승인하지 않았습니다. Django 세션/승인/로그인은 별도로 실제 PostgreSQL 테스트 DB에서 검증했습니다.

## 7. 보안·운영 확인 사항

- 다중 프로세스/서버에서는 add/incr가 원자적으로 동작하는 공유 캐시(Redis/Memcached 등)를 설정해야 전체 인스턴스에 동일한 제한이 적용됩니다. 기본 LocMemCache는 프로세스 단위입니다.
- 역방향 프록시 뒤에서는 신뢰할 프록시에서 REMOTE_ADDR을 정확히 전달/설정해야 합니다. 임의의 외부 X-Forwarded-For를 그대로 신뢰하는 방식으로 바꾸지 마세요. 같은 NAT 주소 사용자는 제한을 공유합니다. 필요하면 프록시/게이트웨이 요청 제한도 추가하세요.
- 배포 환경의 DEBUG=False, HTTPS, Secure 세션/CSRF 쿠키, 요청 본문/민감 필드를 남기지 않는 프록시·APM 로그 정책을 확인하세요. 이번 작업은 기존 환경설정·비밀번호를 출력/커밋하지 않았고 운영 설정을 임의로 변경하지 않았습니다.
- 승인 전 사내 신원·소속은 관리자가 확인해야 합니다. 신청 사유는 신원 증명이 아닙니다.
- 처리된 신청의 해시는 즉시 제거하지만, 이름·사유·처리 이력은 남습니다. 개인정보 보존 기간과 오래된 PENDING 신청 처리 기준은 운영 정책으로 정해야 합니다.
- 공개 상태 조회/이메일·메신저 통지/자동 승인·자동 정리는 구현 범위에 포함하지 않았습니다.
- 기본 VIEWER 그룹의 전역/메뉴 권한이 열람자 정책에 맞게 설정되어 있는지 확인하세요. 가입 승인 자체로 개별 메뉴·문서 권한을 추가 부여하지 않습니다.
- 실제 브라우저와 Django 개발 서버를 연결한 최종 수동 E2E는 테스트용 신청으로 확인하는 것이 좋습니다.

## 화면

- [회원가입 신청 폼 및 필드 오류](registration-form.png)
- [신청 완료](registration-complete.png)
- [관리자 신청 검토](registration-management.png)
- [모바일 신청 폼](registration-form-mobile.png)
- [모바일 신청 관리](registration-management-mobile.png)
