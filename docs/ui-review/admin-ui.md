# 사용자 관리 · 메뉴별 권한 UI 정리 (2026-10-30)

사용자가 추가한 API와 권한 로직을 유지하면서 기존 위키 화면에 디자인을 맞췄습니다. 백엔드·DB 변경은 없습니다.

## 변경 파일

- `frontend/src/components/UserManager.tsx`, `UserManager.css`: 기존 관리 화면과 동일한 제목 크기·화면 폭·여백, 공통 저장/추가/닫기 버튼과 아이콘, 검색 아이콘, 이름·아이디·역할 표시, 텍스트가 있는 활성 상태, 선택 강조, 본인 계정 수정 제한 설명, 접근 가능한 오류/성공 알림, 모바일 목록/상세 배치.
- `frontend/src/components/MenuAccessEditor.tsx`, `MenuAccessEditor.css`: 권한 섹션 아이콘, 한국어 역할 이름과 원래 그룹 코드, 표 헤더·체크박스·hover, 전체 공개 설명, 빈 그룹 상태, 공통 저장 버튼, 모바일 표 내부 스크롤.
- `frontend/src/roleLabels.ts`: 화면 표시용 역할 이름 공유. 실제 API에 전달하는 역할/그룹 값은 변경하지 않았습니다.
- `frontend/src/components/Icon.tsx`: 권한/비밀번호 영역에 사용할 아이콘 추가.
- `frontend/src/App.tsx`: 사용자 관리 메뉴의 스타일/선택 상태/아이콘/Breadcrumb, 준비 중 중복 메뉴 제거, 관리 화면에서 검색 홈·문서 작성·문서 조회로 돌아갈 때 화면 상태 정리, 사용자 관리 진입 시 모바일 사이드바 닫기. 사용자 관리와 메뉴 관리 각각의 기존 권한 확인 결과로 노출합니다.
- `frontend/tests/admin-ui-regression.cjs`: 추가 화면의 브라우저 회귀 검사 및 스크린샷.
- `frontend/tests/ui-regression.cjs`: 실제로 추가된 사용자 관리/메뉴 권한 API에 맞게 테스트 응답 업데이트.

## 검증

- TypeScript/Vite 빌드 및 ESLint 통과. 기존 BlockNote 번들 크기 경고는 유지됩니다.
- 브라우저에서 사용자 검색·생성·변경사항 저장, 본인 계정 수정 제한, 비밀번호 변경 폼 취소, 메뉴 권한 저장, 작성/수정 체크 시 조회 체크 및 조회 해제 시 작성/수정 해제, 오류 상태, 비관리자의 메뉴 숨김, 관리자 화면 간 이동, 390px 모바일 가로 넘침 없음, 기존 문서 편집·저장·복구 회귀 검사를 통과했습니다.
- 테스트용 API 응답을 실제 React 화면에 연결하여 검사했습니다. 실제 사용자 계정·역할·문서·비밀번호를 변경하지 않았습니다. 실제 서버와 연결한 E2E 또는 백엔드 권한 검사를 새로 수행한 것은 아닙니다.

## 화면

- [사용자 관리](user-management.png)
- [사용자 관리 모바일](user-management-mobile.png)
- [메뉴별 접근 권한](menu-access.png)
- [메뉴별 접근 권한 모바일](menu-access-mobile.png)

브라우저 실행 방법은 기존 README와 같으며 새 검사는 `node tests/admin-ui-regression.cjs`로 실행합니다.
