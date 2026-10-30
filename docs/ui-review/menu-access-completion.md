# 메뉴별 그룹 권한 관리 완성 (2026-10-30)

## 변경 파일

1. `frontend/src/components/MenuAccessEditor.tsx`
   - 기존 GET/PUT·표·체크박스·CSRF 구현을 유지했습니다.
   - 최초 GET/직전 저장 결과와 비교해 미저장 변경을 판정합니다. 변경을 원래대로 되돌리면 저장 버튼도 다시 비활성화됩니다.
   - 이동 확인용 ref, 새로고침/탭 닫기 beforeunload 보호, 동기적인 저장 잠금과 부모 상태 동기화를 추가했습니다.
   - 공개 메뉴의 실제 의미, 전역 모델 권한·문서별 제한, 하위 메뉴로 자동 상속하지 않음을 안내합니다.
2. `frontend/src/components/MenuManager.tsx`
   - 기존 메뉴 선택·추가·저장·삭제·닫기를 재사용하며 접근 권한 미저장 시 이동 확인, 저장 중 관련 조작 비활성화를 적용했습니다.
   - 서버의 `can_manage_access`가 참일 때만 기존 상세 영역에 권한 편집기를 표시합니다.
3. `frontend/src/App.tsx`
   - user Props·기존 화면 전환을 유지하면서 메뉴 관리에서 사이드바·브랜드·검색 홈·사용자 관리·문서 작성/조회·로그아웃으로 이동할 때 동일한 변경 확인을 적용합니다.
4. `backend/wiki/menu_management_views.py`
   - 기존 목록 응답에 `can_manage_access`를 추가합니다. 기존 add/change/delete_menu 권한과 구분합니다.
5. `backend/wiki/menu_access_views.py`
   - 기존 Superuser 또는 change_menu 권한을 가진 WIKI_ADMIN 검사를 재사용합니다.
   - JSON 본문이 객체가 아닌 경우 500 대신 400을 반환합니다.
   - 관리 그룹 표시 순서를 WIKI_ADMIN, AUTHOR, VIEWER로 통일합니다. DB 그룹 ID를 사용하며 ID를 하드코딩하지 않습니다.
6. `backend/wiki/test_menu_access.py` (신규): API·접근 범위·요청 검증 테스트 11개.
7. `frontend/tests/menu-access-regression.cjs` (신규): 미저장 이동·지연 GET·실패 재시도·저장 중 보호·실제 응답 ID 사용 검사.
8. `frontend/tests/admin-ui-regression.cjs`, `frontend/tests/ui-regression.cjs`: 서버 capability 필드 및 변경 원복 시 dirty 해제에 맞춰 테스트 응답과 시나리오를 업데이트했습니다.

## 유지한 정책

- 기존 MenuAccess 및 Menu 모델, DB 스키마/마이그레이션은 변경하지 않았습니다.
- `access.py`를 수정하지 않고 실제 판정 결과를 API 테스트로 확인했습니다.
- 전체 저장은 WIKI_ADMIN/AUTHOR/VIEWER 그룹만 대상으로 합니다. SYSTEM_ADMIN/기타 그룹, 다른 메뉴, 하위 메뉴의 기존 규칙은 보존됩니다.
- 공개 메뉴는 그룹별 조회 설정 외에 공개 열람이 적용되며 작성·수정 권한은 별도입니다. 전역 모델 권한은 그대로 필요합니다.
- 메뉴별 허용은 전역 모델 권한을 부여하지 않습니다. 문서별 사용자 지정 제한도 유지됩니다.
- 기존 작업 폴더의 미커밋 변경, 문서·첨부파일·사용자 계정은 초기화하거나 변경하지 않았습니다.

## 발견한 기존 문제와 수정

- 미저장 상태에서 메뉴를 이동하면 변경사항이 사라졌습니다. 확인 후 이동하며 취소하면 선택과 변경을 유지합니다.
- 메뉴 관리 화면에 접근할 수 있다는 사실만으로 권한 편집기가 렌더링됐습니다. 서버의 실제 관리 자격으로 표시를 제한합니다.
- PUT에 JSON 배열/문자열을 보내면 `.get()` 호출이 실패할 수 있었습니다. 객체 형식 검증을 추가했습니다.
- 기존 dirty 플래그는 값을 원래대로 되돌려도 변경됨으로 표시했습니다. 서버 기준값 비교로 수정했습니다.

## 실행 결과

- `npm run build`: 통과 (TypeScript 포함). 기존 BlockNote 관련 500 kB 번들 경고는 남아 있습니다.
- `npm run lint`: 통과.
- `.venv/Scripts/python.exe manage.py check`: 통과.
- `.venv/Scripts/python.exe manage.py test wiki --settings=config.test_settings`: 21개 통과 (기존 회귀 10 + 권한 API 11).
- `node frontend/tests/menu-access-regression.cjs`: 통과.
- `node frontend/tests/admin-ui-regression.cjs`: 통과.
- `node frontend/tests/ui-regression.cjs`: 통과.
- `git diff --check`: 통과.

백엔드 테스트는 메모리 SQLite와 임시 첨부파일을 사용했습니다. 설정된 PostgreSQL 로컬 포트 5433에서 실행 중인 서비스를 확인하지 못했으며 PostgreSQL 행 잠금·동시 트랜잭션은 검증하지 않았습니다. 실제 DB에는 테스트 데이터를 쓰지 않았습니다. 브라우저 검사는 실제 React 화면에 테스트 API 응답을 연결한 것이며 실제 서버에 대한 E2E 검사는 아닙니다.

## 검증 시나리오

- Superuser/권한 있는 WIKI_ADMIN GET·PUT 허용.
- WIKI_ADMIN 이름만 있거나 change_menu만 가진 AUTHOR인 경우 거부; VIEWER·익명 거부.
- 잘못된 그룹 ID·관리 대상 외 그룹·bool/문자열 ID·중복 그룹·그룹 누락·권한 값 비불리언·조회 없는 작성/수정·잘못된 본문 형식은 400이며 기존 DB 상태 보존.
- 메뉴별 저장 이후 실제 메뉴 조회·문서 생성·문서 수정 반영 및 권한 회수.
- 전역 조회/작성/수정 모델 권한이 없으면 메뉴별 허용만으로 작업 불가.
- 공개 열람과 작성/수정 구분, 비공개 전환 시 그룹별 열람 적용.
- SYSTEM_ADMIN 및 기타 그룹, 다른 메뉴/하위 메뉴 규칙 보존, 자동 상속 없음.
- 세션 인증 PUT의 CSRF 검증 및 존재하지 않는 메뉴 404.
- 브라우저에서 체크박스 변경만으로 PUT하지 않음, 변경 이동 취소/확인, 변경 원복, 지연 GET의 이전 데이터 격리, 실패 후 재시도, 저장 중 조작 차단, 응답의 그룹 ID 그대로 저장.
- 기존 사용자 관리와 문서·이력 복구·첨부파일 Wrapper 단일 표시·모바일 화면 검사.

## 수동 확인 / 후속 개선

- PostgreSQL과 실제 개발 서버를 실행한 뒤 실제 Superuser/WIKI_ADMIN/AUTHOR/VIEWER 세션으로 최종 확인하세요.
- 특히 서로 다른 계정에서 권한 저장 전후 메뉴 노출·문서 작성/수정과 공개→비공개 전환을 확인하세요. 현재 열려 있는 다른 사용자 탭은 새로고침이 필요할 수 있습니다.
- PostgreSQL에서 두 관리자가 동시에 저장할 때의 동작은 추가 확인이 필요합니다. 이번 범위에서는 기존 PUT 전체 저장 방식을 유지하므로 뒤에 저장한 설정이 최종 상태가 됩니다.
- 기존 BlockNote 번들 크기 최적화는 별도 작업입니다.
