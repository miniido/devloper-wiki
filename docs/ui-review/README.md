# Developer Wiki UI/UX 리팩터링 검증

## 변경 내용

- `frontend/src/App.tsx`: 헤더 Breadcrumb, 실제 사용자 정보, 선택 상태와 펼침 상태 분리, 다단계 탐색, 단일 하단 새 문서 버튼, 권한별 관리 섹션, 문서 메타데이터·버전, 검색 빈 상태, 저장 중 탐색 방지. 편집기·첨부파일·이력의 별도 Wrapper 유지.
- `frontend/src/menuTree.ts`: 탐색과 관리 화면이 공유하는 parent/sort_order 트리 정렬, 깊이·조상 경로, 숨겨진 상위 메뉴와 순환 데이터 방어.
- `frontend/src/components/UserMenu.tsx`, `Icon.tsx`: 사용자 드롭다운, 외부 클릭·Escape·포커스 이탈 처리, 일관된 SVG 아이콘.
- `frontend/index.html`: 한국어 문서 언어와 BlockNote 모바일 키보드 대응 viewport 설정.
- `frontend/src/App.css`, `index.css`: 중복 CSS 통합, 타이포그래피·여백·버튼·포커스·모바일 탐색·동작 감소 설정.
- `AttachmentSection.tsx`: 파일 유형 아이콘, 크기, 개별 다운로드, 로딩·빈 상태. 추가·삭제는 수정 모드와 편집 권한이 모두 있을 때 표시.
- `RevisionHistory.tsx`: 기본 접힘 및 펼칠 때 조회, 최신 버전·선택 상태, 스크롤 목록, 읽기 전용 미리보기, 복구·로딩·오류 상태, 중복 조회 클릭 방지.
- `MenuManager.tsx`: 실제 깊이 들여쓰기, 정렬된 상위 메뉴 전체 경로, 순환 후보 방어, 정렬·전체 공개 안내.
- `backend/wiki/auth_views.py`: 기존 응답 필드 유지, `role`, `role_label`, `can_manage_menus` 추가. 역할은 그룹 이름과 superuser 여부, 관리 기능은 기존 Django add/change/delete_menu 권한으로 판단. is_staff만으로 권한 부여하지 않음.
- `backend/wiki/views.py`: 기존 perform_create가 get_queryset 내부에 잘못 중첩되어 실행되지 않던 문제 수정. 기존 작성 범위 검사와 작성자·초기 이력 저장이 정상 실행되도록 들여쓰기만 수정.
- `backend/wiki/tests.py`, `backend/config/test_settings.py`: 실제 DB와 분리된 회귀 테스트.
- `frontend/tests/menu-tree.cjs`, `ui-regression.cjs`: 트리와 브라우저 회귀 검사.

사용자 관리 메뉴는 비활성 상태이며 관련 API를 호출하지 않습니다. DB 모델·마이그레이션·프로젝트 데이터·인증 방식은 변경하지 않았습니다. 작업 전부터 있던 미커밋 변경은 유지했습니다.

## 검증 및 범위

- TypeScript 및 Vite production build 통과. BlockNote 관련 번들의 500 kB 초과 경고는 남아 있습니다.
- ESLint 통과.
- Django system check 통과.
- 백엔드 회귀 테스트 10개 통과: 로그인·로그아웃·CSRF, 역할 응답, 비-superuser WIKI_ADMIN, AUTHOR/VIEWER 관리 작업 차단, 메뉴 및 개별 문서 권한, 문서 생성·편집·본문 검색·충돌·이력·복구, 파일 업로드·다운로드·삭제, 본문 이미지 업로드·미리보기, 메뉴 순환 방지 검증.
- 브라우저: 실제 React/BlockNote 화면에 테스트용 API 응답을 연결해 검사했습니다. 3단계 탐색, 6회 반복 펼침·접힘, 메뉴 미선택 안내, 열람 전용 메뉴 생성 차단, 저장·복구, 반복 이동 후 Wrapper 단일 표시, 계정 드롭다운, 역할별 관리 메뉴 숨김, 실제 계층 들여쓰기, 390px 모바일 가로 넘침 없음, 브라우저 실행 오류 없음 확인.
- PostgreSQL 서비스가 실행되지 않은 환경이므로 백엔드 테스트는 메모리 SQLite와 임시 첨부파일로 실행했습니다. PostgreSQL의 동시 행 잠금 동작은 별도로 검증하지 않았습니다. 실제 사용자 세션·실제 문서 데이터로 E2E 검사를 수행한 것은 아닙니다.
- 스크린샷은 실행한 화면의 테스트 데이터 캡처이며 실제 팀 문서를 포함하지 않습니다.

## 다시 실행

프런트엔드 폴더에서 `npm run build`, `npm run lint`, `node tests/menu-tree.cjs`를 실행합니다.

백엔드 폴더에서 `.venv/Scripts/python.exe manage.py test wiki --settings=config.test_settings`를 실행합니다. 테스트 설정은 메모리 SQLite만 사용합니다.

브라우저 테스트는 개발 서버를 먼저 실행하고 `node tests/ui-regression.cjs`를 실행합니다. Playwright 패키지가 필요하며 기본 브라우저는 설치된 Microsoft Edge입니다. `PLAYWRIGHT_MODULE`에 Playwright 모듈 경로, `WIKI_URL`에 서버 주소(기본 localhost:5174), `BROWSER_CHANNEL`에 브라우저 채널을 지정할 수 있습니다. 모든 `/api/` 응답을 테스트가 대체하며 실제 서비스에 데이터를 쓰지 않습니다.

## 화면

- [문서 상세](document-desktop.png)
- [모바일 문서](document-mobile.png)
- [메뉴 관리](menu-management.png)
- [검색 홈](workspace-home.png)
- [문서 편집](document-edit.png)
- [수정 이력 펼침](revision-preview.png)
