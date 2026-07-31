# 파킨온 해외판 — 메뉴 구성 · 기능별 한국 종속성 · 가족 초대 방식 정리안 (Phase 3)

작성 2026-07-01. 상위 문서: [overseas_expansion_review.md](./overseas_expansion_review.md) · [overseas_execution_plan.md](./overseas_execution_plan.md)
범위: **조사 + 제안만.** 이 문서는 앱/서버 코드를 수정하지 않습니다. 실제 구현은 오너 결정 후 별도 진행.
대상 1차 시장: 미국·캐나다·호주·뉴질랜드·일본. "해외 = 비한국 로케일"로 표기.

> ⚠️ 영국·아일랜드는 **의도적으로 제외**했다(오너 결정). EEA/UK 는 GDPR·대리인 등
> 유럽과 같은 제약이 걸려 준비 부담이 크다. 실제 배포 국가는 위 5개국 + 한국이다.

---

## 0. 오너 결정이 필요한 항목 (먼저 정해야 나머지가 진행됨)

> ✅ **오너 결정(2026-07-03): D1~D7 전부 이 문서의 권장안대로 확정.** 1차 = 한국 특화 기능(약검색·처방전·운동영상) 숨김, 로그인 Apple/Google, 문의 이메일, 가족초대·나머지 영어 번역, 개발자 편지 영어 노출. 대체 기능은 2차 이후.

| # | 결정 사항 | 선택지 | 이 문서의 권장 | 이유 |
|---|---|---|---|---|
| D1 | **로케일 판정 기준** | (a) 기기 언어(`getLocales`) / (b) 사용자 프로필 국가 / (c) 스토어 배포 지역 빌드 분기 | (a) 기기 언어 = 한국어면 국내판, 아니면 해외판 | 이미 Phase 1에서 `expo-localization` 도입 예정. 단일 코드베이스 + OTA로 게이트 가능 |
| D2 | **약검색(식약처)** | (a) 해외 완전 숨김(수동 입력만) / (b) RxNorm/openFDA 대체 | 1차 = (a) 숨김. 대체는 2차 이후 | 수동 입력 흐름이 이미 상시 존재 → 없어도 출시 가능. 대체는 공수 큼 |
| D3 | **문의 채널** | (a) 이메일(`contact@ourmine.co.kr`) / (b) 웹 문의폼(parkinon.com) / (c) 앱스토어 리뷰 유도 | (a) 이메일 `mailto:` (이미 앱 내 다른 곳에서 쓰는 주소) | 카카오 오픈채팅은 해외 무의미. 이메일이 즉시 가능·추가 인프라 0 |
| D4 | **가족 초대 공유 방식** | (a) 현행 유지(문구만 영어화) / (b) 초대 딥링크 도입 / (c) 코드+링크 병행 | 1차 = (a) 시스템 공유 + 영어 문구. 딥링크는 2차 | 공유는 이미 OS 기본 `Share`라 카카오 비종속 → 문구만 영어화하면 끝. 딥링크는 별도 설계·네이티브 작업 |
| D5 | **운동 영상** | (a) 해외 숨김 / (b) 영어 콘텐츠 소싱 후 노출 | 1차 = (a) 숨김 | 현재 `parkinson.co.kr` 한국 유튜브 하드코딩. 콘텐츠 교체는 대공수 |
| D6 | **개발자 편지(DevLetterModal)** | (a) 해외 숨김 / (b) 영어 번역본 | (b) 영어 번역 권장(브랜드 스토리라 가치 큼), 단 "상단 카카오톡 이모티콘" 문구는 문의 채널(D3)에 맞게 교체 필수 | 카카오 아이콘이 해외판엔 없음 → 안내 문구 불일치 방지 |
| D7 | **처방전 OCR** | (a) 해외 숨김 / (b) 그대로 노출(영어 처방전 실험) | 1차 = (a) 숨김(복용약·진료기록 등록의 "처방전으로 등록" 탭만 로케일 게이트) | 한국 처방전 포맷 + 추출 약명이 식약처 매칭에 의존. 수동 입력 탭은 유지 |

> D1이 가장 먼저. 나머지 게이트가 전부 D1의 로케일 판정에 얹힘.

---

## 1. 메뉴(햄버거) · 상단바 구성표

근거 파일: `src/screens/menu/MenuScreen.tsx`, `src/components/common/TopBar.tsx`

### 1-A. 메뉴 화면 항목 (MenuScreen.tsx)

`MENU_SECTIONS` 상수(`MenuScreen.tsx:57-148`) + 계정 섹션(인라인 `:478-512`). 항목은 역할(환자/보호자)·피처플래그로 동적 가감됨.

| 섹션 | 항목(key) | 라벨 | 여는 화면 | 국내 | 해외 | 조치 |
|---|---|---|---|---|---|---|
| 기록 | Diary | 파킨온 일기 | `Diary`(Root 스택) | O | O | 유지(번역) |
| 기록 | Records | 작성 기록 보기 | `Records` | O | O | 유지(번역) |
| 기록 | MeasurementRecords / CaregiverMeasurementView | 컨디션 측정 기록 보기 / ○○님 컨디션 보기 | `MeasurementRecords` | 플래그 off(현재 숨김) | 동일 | 무변경(`MEASUREMENT_FEATURE_ENABLED=false`) |
| 기록 | VideoList | 영상 기록 보기 | `VideoList` | O | O | 유지(번역). ※ 운동영상 탭(D5)과 별개, 몸상태 촬영 기록임 |
| 기록 | MedicalRecordList | 진료 기록 | `MedicalRecordList` | O | O | 유지(번역). 병원명 placeholder만 영어 예시로 |
| 관리 | FamilyLink | 가족 연동 | `FamilyLink` | O | O | 유지, 공유 문구 영어화(→ 3장) |
| 관리 | MyMeds | 복용약 관리 | `MedicationManage{mode:'meds'}` | O | O | 유지. 내부 "약검색/처방전 등록" 탭만 게이트(D2/D7) |
| 관리 | DoseSlots | 복용시간 설정·알림 | `MedicationManage{mode:'slots'}` | O(환자) | O(환자) | 유지(번역). 보호자는 기존대로 숨김 |
| 관리 | Settings | 그 밖의 알림 / 보호자용 알림 | `Settings` | O | O | 유지(번역) |
| 관리 | AlarmSoundSettings | 알림음 관리 | `AlarmSoundSettings` | O | O | 유지(번역) |
| 기타 | BlockedUsers | 차단한 사용자 관리 | `BlockedUsers` | O | O | 유지(번역) |
| 기타 | Terms | 이용약관 | `Terms` | O | O | 유지, 영어판 약관 라우팅(Phase 4) |
| 기타 | Privacy | 개인정보처리방침 | `Privacy` | O | O | 유지, 영어판(Phase 4) |
| 계정 | (logout) | 로그아웃 | `handleLogout`(`:329`) | O | O | 유지(번역) |
| 계정 | (withdraw) | 회원탈퇴 | `handleWithdraw`(`:341`, delete-account Edge Function) | O | O | 유지(번역). removeFamilyMember/탈퇴는 로케일 무관 |
| 프로필 | (card) | 프로필 수정 | `ProfileEdit` | O | O | 유지(번역) |

메뉴 항목 자체는 **한국 종속이 없어 전부 유지**. 필요한 조치는 대부분 "번역"이며, 게이트가 필요한 곳은 메뉴 항목이 아니라 그 하위 화면 내부 탭(약검색·처방전 OCR)입니다.

### 1-B. 상단바(TopBar) 버튼

`TopBar.tsx`는 prop 기반. 실제 노출은 각 화면이 결정.

| 버튼 | prop | 노출 화면 | 동작 | 국내 | 해외 | 조치 |
|---|---|---|---|---|---|---|
| 파킨온 로고 | `showParkinon` | 여러 화면 | `Medication`으로 이동 | O | O | 유지 |
| 일기 | `showDiary` | Medication/Menu 등 | `Diary` 진입 | O | O | 유지(번역) |
| 알림 종 | `showBell` + `bellBadge` | 여러 화면 | `NotificationHistory` | O | O | 유지(번역) |
| **카톡 문의** | `showKakao` | **`MedicationScreen.tsx:1183-1186`에서만** | `Linking.openURL(KAKAO_OPEN_CHAT_URL)` | O | **숨김/대체** | 해외 로케일에서 `showKakao=false` + 이메일 문의 버튼으로 대체(D3) |

카톡 문의 버튼은 **약복용 메인 화면 상단바에만** 존재합니다(`src/constants/links.ts:6`의 `KAKAO_OPEN_CHAT_URL`). 해외판은 이 아이콘을 숨기고, 필요하면 같은 자리를 이메일 문의 아이콘(`mailto:`)으로 대체하는 것이 자연스럽습니다.

---

## 2. 기능별 한국 종속성 → 해외 조치표

조치 범례: **빼기**(코드/기능 제거) · **숨김**(로케일 게이트, 코드 유지) · **대체**(다른 수단) · **유지**(그대로).

| 기능 | 한국 종속 근거(파일:줄) | 종속 강도 | 해외 조치 | 방법 | OTA |
|---|---|---|---|---|---|
| **카카오 로그인** | `LoginScreen.tsx:207-224` 카카오 버튼, `handleKakaoLogin :142-151`. 백엔드 `supabase/functions/kakao-auth/` | 중 | **숨김** | 해외 로케일에서 카카오 버튼 비노출. Apple(`:245-266`)/Google(`:226-243`) 이미 구현됨 → 대체 수단 확보. 네이티브 카카오 SDK는 그대로 두므로 OTA 가능 | O |
| **식약처 약검색·낱알식별** | `supabase/functions/mfds-proxy/index.ts:36-40`(공공데이터포털). UI `MedicationManageScreen.tsx:216-284` 호출, "출처: 식약처" `:605-618` | 강 | **숨김**(1차) → 2차 RxNorm/openFDA 대체 | 해외 로케일에서 약검색 UI·"출처: 식약처" 라벨 숨김. **수동 직접입력 탭 유지**(`:2839-2849` 상시 존재, `:1645` 폴백) | O |
| **처방전 OCR** | 진입 `MedicationManageScreen.tsx:2823-2837` "처방전으로 등록", `MedicalRecordWriteScreen.tsx:411-442`. 백엔드 `ocr-prescription`(Claude Vision) | 중 (OCR 자체는 비한국, 약명 매칭이 식약처 의존) | **숨김**(1차) | "처방전으로 등록" 탭만 로케일 게이트. 수동 입력 탭은 유지 | O |
| **운동 영상** | `ExerciseVideoScreen.tsx:36-37` `VIDEO_DATA` YouTube ID 하드코딩, 출처 `parkinson.co.kr`(`:127`). 진입 `ExerciseScreen.tsx:273` | 강(콘텐츠 고정) | **숨김**(1차) → 콘텐츠 소싱 시 대체 | "운동 영상 보기" 진입 버튼 로케일 게이트. 영상 상수 자체는 유지(도달 불가만) | O |
| **문의(카카오 오픈채팅)** | `links.ts:6` `KAKAO_OPEN_CHAT_URL`, 상단바 `MedicationScreen.tsx:1183-1186`, 안내 `DevLetterModal.tsx:53-54` | 강(카톡 없음) | **대체** | 이메일 `mailto:contact@ourmine.co.kr`(이미 `banGuard.ts:21` 등에서 사용) 또는 웹 문의폼. 상단바 아이콘 교체 + DevLetter 문구 교체(D6) | O |
| **개발자 편지** | `DevLetterModal.tsx:43-55` 전부 한국어, "상단 카카오톡 이모티콘" 안내(`:53`) | 중 | **대체/번역** | 영어 번역본 + 문의 안내를 D3 채널로. (한국어 원문은 국내 유지) | O |
| **진료/병원** | `AppointmentWriteScreen.tsx:584` placeholder "예) 한강성심병원" | 약(예시 문구뿐) | **유지** | 병원명·의사명 자유 텍스트라 특화 API 없음. placeholder 영어 예시로만 교체 | O |
| **로케일 포맷 `ko-KR`** | `NotificationHistoryScreen.tsx:64,67,73,86`, `ExerciseScreen.tsx:314`, `MedicationManageScreen.tsx:2778` `localeCompare(..,'ko')` | 중 | **대체** | 하드코딩 `ko-KR` 제거 → 로케일 자동(Phase 2 i18n 범위) | O |
| **타임존 `Asia/Seoul` 폴백** | `timezone.ts:12,15`, `notifActionFeedback.ts:19,53`, `notifications.ts:164` | 중 | **대체** | 기기 IANA 감지 우선, 폴백만 서울(Phase 1 타임존화 범위) | O(클라) / 서버는 크론 재작성 |
| 통화(원화)·지도(카카오맵)·전화형식 | grep 무매치 | 없음 | **유지** | 해당 기능 자체가 없음 → 조치 불필요 | — |

전 항목 **OTA 가능**(카카오 SDK·OCR 백엔드는 코드에 남겨두고 노출만 게이트). 유일한 서버측 작업은 알림 타임존화(Phase 1, 크론 재작성)이며 이는 본 문서 범위 밖.

---

## 3. 가족 초대 / 연동 — 해외 방식 제안 (핵심)

근거 파일: `src/hooks/useFamilyLink.ts`, `src/screens/menu/FamilyLinkScreen.tsx`, `src/screens/onboarding/FamilyInviteScreen.tsx`, `src/screens/onboarding/FamilyCheckScreen.tsx`

### 3-A. 현행 흐름 요약

1. **코드 발급**: 순수 숫자 6자리(`useFamilyLink.ts:56-62` `generateCode`), **유효 24시간**(`:121` `expiresAt`). `patient_groups.invite_code(char6)` + `invite_code_expires_at`. PostgREST REST 직접 fetch(RPC 아님). FamilyLinkScreen은 공유 버튼 누를 때만 발급(`:202-211`).
2. **공유**: **OS 기본 `Share.share()`** — 카카오 SDK 아님. 버튼 이름만 "카카오톡으로 초대하기". 문구는 하드코딩 한국어 + **App Store/Play 링크 병기**.
   - 실운영: `FamilyLinkScreen.tsx:213-215` (라벨 "연결 번호", 코드 raw)
   - 온보딩: `FamilyInviteScreen.tsx:96-100` (라벨 "초대 번호", 코드 3-3 포맷, `title` 포함)
3. **코드 입력 → 연동**: 바텀시트 6자리 입력(`FamilyLinkScreen.tsx:460-471`) → `joinByCode`(`useFamilyLink.ts:278`) → RPC `join_family_by_code`. 온보딩은 `FamilyCheckScreen`에서 코드 확인(`lookup_group_id_by_invite_code`, `get_invite_patient_masked_name`) 후 완료 시점에 합류.
4. **연동 해제**: `removeFamilyMember`(`useFamilyLink.ts:467-507`) → RPC `remove_family_member`. UI `FamilyLinkScreen.tsx:178-197`.

핵심 발견: **공유 경로에 카카오 종속이 전혀 없음**(`@react-native-seoul/kakao-login`은 로그인 전용, `useAuth.ts:15`·`LoginScreen.tsx`에서만 사용). 노란 버튼 스타일과 "카카오톡" 라벨만 카카오를 흉내낼 뿐, 실제로는 OS 공유 시트가 뜹니다. 따라서 **해외 전환은 문구/라벨 교체만으로 충분**합니다.

### 3-B. 현행 vs 대안

| 방식 | 내용 | 장점 | 단점 | 권장 |
|---|---|---|---|---|
| (a) **시스템 공유 + 영어 문구** | 버튼 라벨을 "Invite family / Share"로, 공유 문구·스토어 링크 영어화. `Share.share`는 그대로 | 공수 최소(문구·라벨만), 이미 OS 공유라 문자·이메일·메신저 무엇이든 커버, OTA 가능 | 코드 수동 입력은 여전히 필요 | **1차 채택** |
| (b) 초대 딥링크(유니버설 링크) | 링크 탭 → 앱 설치/열기 → 코드 자동 주입 | UX 최상(수기 입력 제거) | Universal Link/App Link 설정·연관도메인·라우팅 구현 = 네이티브 작업, OTA 불가. 미설치 시 스토어 폴백 처리 필요 | 2차 |
| (c) 코드 입력 유지 | 6자리 코드 방식 그대로 | 안정적·이미 검증됨 | — | (a)의 폴백으로 유지 |

### 3-C. 권장안 (1차)

1. **버튼 라벨 로케일화**: "카카오톡으로 초대하기" → 영어(예 "Invite family"). 노란 카카오 스타일 → 중립 버튼 스타일(해외판).
2. **공유 문구 영어화 + 스토어 링크 유지**: `FamilyLinkScreen.tsx:213-215`, `FamilyInviteScreen.tsx:96-100` 두 문구를 로케일별로. App Store/Play 링크는 이미 병기됨(URL은 국가 무관 동작). 코드 라벨·포맷 불일치("연결 번호" raw vs "초대 번호" 3-3)는 이 기회에 통일 권장.
3. **코드 입력 방식 유지**: 6자리 숫자 + 24시간 만료 그대로(로케일 무관). 딥링크는 2차.
4. **연동 해제는 로케일 무관 유지**: `removeFamilyMember`/`leaveGroup` 변경 없음.
5. (선택) 코드 생성 로직이 `useFamilyLink.ts:56`과 `FamilyInviteScreen.tsx:44`에 **중복 정의**, 문구도 두 곳에 중복. i18n 도입 시 공통화하면 유지보수/번역 누락 방지에 유리(리팩터 여부는 오너 판단).

---

## 4. 구현 시 주의 (범위 밖 참고)

- **온보딩과 메뉴가 이원화**: 메뉴(`FamilyLinkScreen`)는 `useFamilyLink` 훅, 온보딩(`FamilyInviteScreen`/`FamilyCheckScreen`)은 자체 fetch·AsyncStorage 구현. 로케일 게이트/번역을 **양쪽 다** 적용해야 누락 없음.
- **게이트는 노출만, 코드는 존치**: 카카오 SDK·mfds-proxy·ocr-prescription·운동영상 상수는 그대로 두고 진입로만 로케일로 가림 → 전부 OTA로 배포·복구 가능(`MEASUREMENT_FEATURE_ENABLED` 피처플래그와 같은 패턴).
- **번역은 Phase 2 i18n에 의존**: 본 문서의 "유지(번역)" 다수는 i18n 프레임워크 도입 후 일괄 처리가 효율적. 로케일 게이트(카카오/약검색/영상/문의)는 i18n 이전에도 단독 적용 가능.
