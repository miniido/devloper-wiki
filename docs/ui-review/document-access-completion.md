# 문서별 CUSTOM 권한 관리 구현 결과

## 수정·추가 파일

- `backend/wiki/document_access_views.py` (추가): GET/PUT 문서 권한 관리 API, 관리자·실제 수정 범위 검사, 그룹/boolean/중복/의존성 검증, 트랜잭션 저장.
- `backend/wiki/access.py`: 공통 문서 판정에 전역 view_document/change_document 검사 및 문서 권한 관리 capability 추가. 첨부파일·이미지·수정 이력 API가 사용하는 기존 공통 함수를 보강했습니다.
- `backend/wiki/serializers.py`: 문서 응답에 use_custom_permissions와 can_manage_access 추가. 일반 문서 생성/수정 API에서 권한 모드는 읽기 전용입니다.
- `backend/wiki/urls.py`: documents/<document_id>/access/ 경로 등록.
- `frontend/src/components/DocumentAccessManager.tsx`, `DocumentAccessManager.css` (추가): 기존 권한 표·버튼 스타일을 재사용하는 문서 설정 패널.
- `frontend/src/App.tsx`: 상단 접근 권한 버튼, 서버 capability 표시 제한, CUSTOM 배지, 미저장 이동 확인, 저장 후 문서 목록·편집 가능 상태 갱신. 기존 user Props와 편집기·첨부파일·이력 Wrapper 유지.
- `backend/wiki/test_document_access.py` (추가): CUSTOM 권한 API·직접 접근 차단 테스트 16개.
- `frontend/tests/document-access-regression.cjs` (추가): 모드 전환·저장·실패 재시도·문서 전환·권한 상실·모바일 검사.

## 구현 기능 및 보존 정책

- GET /api/documents/{document_id}/access/ 응답: document_id, title, use_custom_permissions, groups(group_id, group_name, can_view, can_edit).
- PUT은 use_custom_permissions 및 전체 관리 그룹 배열을 제출합니다. ID는 GET 응답을 그대로 사용합니다.
- 메뉴 권한 사용/문서별 CUSTOM 전환, 수정 체크 시 조회 자동 선택, 조회 해제 시 수정 자동 해제, 성공/오류/로딩·재조회, 저장 중 중복 요청 방지.
- 문서 이동·다른 화면 이동·닫기·로그아웃에 미저장 확인을 적용하고, 새로고침·탭 닫기에는 beforeunload 보호를 적용했습니다.
- 메뉴 모드에서도 제출한 그룹 설정을 저장·보관하고, 실제 추가 접근 제한은 CUSTOM에서만 평가합니다. CUSTOM 해제 시 기존 설정을 삭제하지 않으며 다시 켜면 재사용합니다.
- WIKI_ADMIN/AUTHOR/VIEWER만 수정합니다. SYSTEM_ADMIN 등 다른 그룹의 규칙, 다른 문서, 메뉴 권한은 변경하지 않습니다.
- 권한 변경은 콘텐츠 수정 버전/이력과 분리되며, 문서 본문·버전·첨부파일을 변경하지 않습니다. 기존 DB 모델 및 스키마 변경이 없어 새 마이그레이션은 없습니다.

## 최종 판정 구조

1. 인증 및 활성 계정 검사. Superuser는 기존과 같이 범위를 우회합니다.
2. 전역 문서 조회 권한(view_document); 수정은 change_document도 필요합니다.
3. 소속 메뉴의 조회/수정 범위 확인.
4. use_custom_permissions=True이면 DocumentAccess의 그룹별 조회/수정 조건 추가.
5. 문서 목록·상세·저장, 첨부파일 목록/업로드/다운로드/삭제, 인라인 이미지 미리보기/다운로드, 수정 이력/복원에 동일한 공통 문서 판정이 적용됩니다.

권한 관리 API 자체는 Superuser 또는 WIKI_ADMIN 역할과 현재 문서의 실제 수정 권한을 모두 가진 사용자만 사용할 수 있습니다. 일반 작성자가 문서를 수정할 수 있어도 권한 관리 버튼/API는 허용되지 않습니다. 일반 문서 PATCH로 CUSTOM 모드를 변경할 수도 없습니다.

## 테스트 결과

- npm run build / npm run lint: 통과.
- python manage.py check: 통과.
- python manage.py makemigrations --check --dry-run --settings=config.test_settings: No changes detected.
- python manage.py test wiki --settings=config.test_settings: 총 37개 통과(기존 21 + 신규 16).
- document-access-regression.cjs / menu-access-regression.cjs / admin-ui-regression.cjs / ui-regression.cjs: 모두 통과.
- git diff --check: 통과.

백엔드는 메모리 SQLite·임시/메모리 파일 저장소에서 검증했습니다. 실제 프로젝트 DB나 파일에 테스트 데이터를 쓰지 않았습니다. 처음 제한된 실행 환경에서 기존 파일 테스트가 임시 폴더 권한 문제로 중단됐으나, 허용된 별도 실행에서 전체 37개가 통과했습니다. 브라우저 검사는 실제 React/BlockNote 화면에 테스트용 API 응답을 연결한 검사이며 실제 서버와 연결한 E2E는 아닙니다.

검증한 주요 항목: 역할별 GET/PUT 허용·거부, 메뉴 범위를 CUSTOM이 우회하지 못함, CUSTOM 해제/재활성화 시 규칙 보존, 전역 권한이 없는 계정의 직접 파일·이미지·이력 URL 차단, CUSTOM 조회만 허용된 사용자의 수정·업로드·삭제·복원 차단, 정상 수정·파일 작업, 관리 대상 외 그룹 보존, 잘못된 ID·중복 그룹·비불리언·필드 누락·잘못된 JSON 거부, 저장 중 오류 시 트랜잭션 전체 롤백, CSRF 검증, 일반 PATCH의 모드 변경 차단, 문서 이동/미저장 확인, 화면 갱신 후 편집·조회 권한 상실 처리, Wrapper 단일 유지, 모바일 가로 넘침 없음.

## 수동 확인 및 남은 사항

- 실제 PostgreSQL·Django 서버와 역할별 계정에서 최종 E2E를 확인해야 합니다. 로컬 5433 포트의 PostgreSQL 리스너를 확인하지 못했으며, PostgreSQL 행 잠금·동시 요청 동작은 미검증입니다.
- 일반 WIKI_ADMIN도 본인의 문서 권한을 제거하면 관리 권한을 잃습니다. 이때 Superuser가 복구해야 하며 UI에 안내했습니다.
- 권한을 변경한 다른 사용자 탭의 즉시 갱신은 구현하지 않았습니다. 다시 조회/새로고침 시 반영되며 서버는 모든 요청에서 권한을 최종 검사합니다. 이미 다운로드한 파일이나 이미 읽은 본문은 회수할 수 없습니다.
- 기존 PUT 전체 저장 방식을 따르므로 동시 관리자 저장은 마지막 저장이 우선합니다. 별도 권한 변경 감사 이력/낙관적 충돌 검사는 후속 작업입니다.
- 기존 문서 상세 API는 RetrieveUpdateAPIView로 DELETE를 제공하지 않습니다. 이번 범위에서 삭제 기능을 새로 만들지는 않았습니다.
- 기존 BlockNote 번들의 500 kB 초과 경고는 남아 있습니다.
- 문서 저장소를 웹서버에서 별도로 공개하지 말고 인증/권한을 검사하는 API로 제공해야 합니다. 현재 Django URL 설정에 공개 media 경로는 없습니다.

## 화면

- [문서 접근 권한](document-access.png)
- [모바일](document-access-mobile.png)
