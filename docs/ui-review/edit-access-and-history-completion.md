# 작성·수정 권한 설정 및 이력 개별 삭제 결과

## 1. 수정·추가 파일

### 백엔드
- `backend/wiki/access.py`: 새 문서를 작성할 때 권한 설정까지 가능한지 판단하는 capability 추가.
- `backend/wiki/document_access_views.py`: 기존 역할/그룹/타입 검증 재사용, 공통 저장 함수, 새 문서 권한 옵션 GET 추가.
- `backend/wiki/serializers.py`: 문서 저장 요청의 선택적 권한 필드, 관리자 자격 검증, 문서/권한 저장 통합, 생성/이력 삭제 capability 응답.
- `backend/wiki/views.py`: 권한만 바뀐 요청 처리와 기존 본문/버전 트랜잭션 통합.
- `backend/wiki/revision_views.py`: 이력별 삭제 가능 여부와 DB ID 기반 개별 삭제 API.
- `backend/wiki/urls.py`: 새 옵션/이력 삭제 경로 등록.
- `backend/wiki/test_edit_access_and_revision_delete.py` (추가): 신규 회귀 테스트 18개.
- `backend/wiki/test_document_access.py`: 권한 필드를 조용히 무시하던 기존 테스트를 명시적 403 정책으로 변경.

### 프런트엔드
- `frontend/src/components/DocumentAccessManager.tsx`: 기존 패널에 작성/수정용 로컬 초안 모드 추가. 새 문서 옵션 또는 기존 설정을 불러오며 본문 저장 전에는 PUT을 보내지 않습니다.
- `frontend/src/components/DocumentAccessManager.css`: 현재 권한 모드 표시와 좁은 화면의 버튼 배치.
- `frontend/src/App.tsx`: 작성/수정 상단 권한 설정 버튼, 권한 초안과 본문을 같은 요청으로 저장, 미저장 이탈 확인, 저장 실패 입력 유지, 저장 후 capability/목록 반영. user Props 및 세 Wrapper 유지.
- `frontend/src/components/RevisionHistory.tsx`: 관리자 전용 삭제 버튼, 확인·로딩·오류·성공 상태, 삭제 후 재조회/선택 초기화, 복원과 삭제 동시 실행 방지.
- `frontend/src/components/Icon.tsx`: 삭제 아이콘.
- `frontend/src/App.css`: 이력 행과 삭제 버튼의 최소 스타일.
- `frontend/tests/edit-access-and-revision-delete.cjs` (추가): 신규 화면 회귀 검사와 캡처.

## 2. 구현 기능

- 새 문서는 메뉴 권한 사용이 기본입니다. 관리자만 작성 단계에서 CUSTOM을 선택하고 그룹별 조회/수정 권한을 지정할 수 있습니다.
- 기존 문서 수정 화면은 서버 설정을 불러옵니다. 수정 선택 시 조회를 켜고, 조회 해제 시 수정을 끕니다.
- 권한 패널을 닫아도 작성 중인 설정을 유지합니다. 다른 문서/메뉴/관리 화면으로 이동하거나 취소·로그아웃할 때 권한 초안이 미저장 상태라면 확인합니다. 새로고침/탭 닫기에는 beforeunload 보호를 적용합니다.
- 권한 모드가 상단 버튼에 메뉴 권한/사용자 지정으로 표시됩니다. 권한 설정을 불러오지 못한 상태에서는 저장을 막고 패널에서 재시도할 수 있습니다.
- 문서 저장 실패 시 제목, BlockNote 내용, 권한 초안을 유지합니다.
- 서버 저장 성공 뒤 목록 조회만 실패한 경우 저장 성공과 갱신 실패를 구분해 중복 생성을 유도하지 않습니다.
- 과거 수정 이력을 개별 삭제할 수 있고, 본문/현재 버전은 건드리지 않습니다.

## 3. 권한 판정과 원자적 저장

기존 전역 문서 권한 → 메뉴 범위 → CUSTOM 문서 범위를 유지합니다. Superuser의 기존 우회 정책도 유지합니다.

문서 생성 권한 관리: Superuser 또는 전역 view_document/change_document를 가진 WIKI_ADMIN 역할에 더해 add_document와 대상 메뉴 작성 범위가 필요합니다. 기존 문서 권한 변경: 기존 can_manage_document_access 정책(관리자 역할 + 문서의 실제 수정 가능 범위)을 사용합니다.

- 신규 옵션 API: `GET /api/documents/access-options/?menu={menu_id}`.
- 기존 문서 설정 조회: `GET /api/documents/{id}/access/` 재사용.
- 생성/수정 본문에 `use_custom_permissions`와 `access_groups` 전체 관리 그룹 배열을 선택적으로 포함합니다. menu 필드 등 기존 요청 형식은 유지합니다.
- 권한 필드가 아예 없는 요청은 기존처럼 동작합니다. 권한 필드를 보낸 자격 없는 사용자는 false 값이라도 403을 받습니다. 권한 필드 한쪽 누락, 잘못된 ID/중복/비불리언/수정만 허용 등은 400입니다.
- 본문과 권한을 바꿀 때 문서·DocumentAccess·수정 이력을 같은 트랜잭션에 저장합니다. 수정 시 기존 문서 행 잠금과 버전 충돌 검사를 사용합니다.
- 권한만 바뀌면 본문 이력/버전/수정일을 불필요하게 변경하지 않습니다.
- 메뉴 권한 모드로 전환해도 관리 그룹의 CUSTOM 설정을 보관합니다. 관리 대상 외 그룹과 다른 문서는 변경하지 않습니다.
- 관리 그룹 ID는 API 응답에서 가져오며 프런트엔드에 고정 ID가 없습니다.

## 4. 이력 삭제 제한

기존 GET 미리보기/POST 복원 경로는 **버전 번호**를 사용하므로 변경하지 않았습니다. 혼동 방지를 위해 삭제만 명시적인 **DB ID** 경로를 추가했습니다.

`DELETE /api/documents/{document_id}/revisions/by-id/{revision_id}/`

- Superuser 또는 해당 문서를 실제로 수정할 수 있는 WIKI_ADMIN만 허용합니다. AUTHOR/VIEWER는 403입니다.
- document_id와 revision_id의 소속을 함께 검사하며, 없거나 다른 문서 이력이면 404입니다.
- 최신 판정은 목록의 마지막 행이나 최대 버전이 아니라 **현재 Document.version**을 기준으로 합니다. 현재 버전 및 현재보다 큰 비정상 이력은 409입니다.
- 최소 1개 이력을 남깁니다. 현재 버전 행이 없는 레거시 데이터라도 남은 이력이 하나면 삭제를 거부합니다.
- 문서 행을 잠그고 대상/버전/개수를 확인한 뒤 트랜잭션으로 삭제합니다. 기존 수정·복원 API도 같은 문서 행을 잠급니다.
- 삭제 후 나머지 버전은 재번호하지 않습니다. 문서 제목/본문/버전/수정일을 변경하지 않습니다.
- 삭제된 버전의 조회/복원은 404입니다. 복원으로 생성된 새 이력도 같은 규칙을 따릅니다.
- UI는 삭제 버전과 복구 불가를 확인하고, 처리 중 삭제/복원을 비활성화합니다. 성공 후 목록을 GET으로 다시 읽으며 선택한 삭제 버전의 미리보기를 닫습니다. 최신/마지막 이력에는 삭제 버튼을 표시하지 않습니다.
- 전체 이력 일괄 삭제 기능은 추가하지 않았습니다.

## 5. 빌드 및 테스트

- `python manage.py check`: 통과.
- `python manage.py makemigrations --check --dry-run --settings=config.test_settings`: No changes detected.
- `python manage.py test wiki --settings=config.test_settings`: **55개 통과** (기존 37 + 신규 18).
- `npm run build` (TypeScript 포함): 통과. 기존 BlockNote 번들 크기 경고는 유지됩니다.
- `npm run lint`: 통과.
- 새 `edit-access-and-revision-delete.cjs` 및 기존 document-access/menu-access/admin-ui/ui-regression 브라우저 검사 5개 모두 통과.
- `git diff --check`: 통과.

신규 테스트는 생성/수정의 본문·권한·이력 롤백, 역할별 차단, 비공개 메뉴 범위, 파일/인라인 이미지 직접 URL 차단, 기본/기존 요청 호환성, 권한 해제 시 설정 보존, 관리자 삭제, 현재/미래/마지막 이력 보호, 다른 문서 ID/없는 이력 차단, 삭제 롤백, 남은 버전 복원 및 새 최신 이력 보호, CSRF, 프런트엔드 입력 유지/확인창/삭제 재시도/목록 갱신/모바일/Wrapper 단일 표시를 검증합니다.

백엔드는 메모리 SQLite·임시/메모리 파일 저장소에서 수행했습니다. 실제 DB나 문서/사용자/첨부파일에 테스트 데이터를 쓰거나 실제 이력을 삭제하지 않았습니다. 브라우저는 실제 React/BlockNote 화면에 테스트 API 응답을 연결한 검사입니다.

## 6. 수동 확인

- 실제 PostgreSQL과 Django 서버를 실행해 Superuser/WIKI_ADMIN/AUTHOR/VIEWER 계정별 최종 E2E를 확인해야 합니다.
- PostgreSQL에서 두 관리자의 동시 수정·복원·삭제 시 잠금 동작은 별도로 확인해야 합니다. SQLite 테스트로 행 잠금의 동시성까지 보장했다고 주장하지 않습니다.
- 본인에게 문서 접근을 주지 않는 CUSTOM을 저장했을 때 문서가 목록/상세에서 사라지고 Superuser로 복구 가능한지 확인하세요.
- 실제 이력 삭제는 되돌릴 수 없으므로 수동 검증에는 별도 테스트 문서를 사용하세요.

## 7. 발견한 문제 및 남은 개선

- 기존 문서 저장 API는 권한 모드를 읽기 전용으로 조용히 무시했습니다. 이번 명시적 오류 정책에 맞게 관리자만 확장 필드를 사용할 수 있도록 수정했습니다.
- 기존 저장 흐름은 목록 갱신 실패도 문서 저장 실패로 취급해 재시도 시 중복 생성 위험이 있었습니다. 서버 저장 이후 갱신 오류를 별도로 처리했습니다.
- 다른 사용자 탭의 실시간 권한 변경 알림은 범위 밖입니다. 서버는 매 요청 권한을 확인하며 기존 탭은 재조회/새로고침이 필요할 수 있습니다.
- 권한 변경 감사 로그·자동 이력 정리·통합 검색·대시보드·자동 저장·전체 이력 일괄 삭제는 추가하지 않았습니다.
- 기존 문서 상세 API의 DELETE 미지원 상태는 유지했습니다(이번 범위는 이력 삭제).
- 환경설정·비밀번호는 출력하거나 변경/커밋하지 않았으며 기존 미커밋 변경을 보존했습니다.

## 화면

- [문서 수정 중 권한 설정](document-edit-access.png)
- [모바일 권한 설정](document-edit-access-mobile.png)
- [이력 삭제 후 목록](revision-delete.png)
