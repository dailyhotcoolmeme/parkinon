# ⛔ 필독 - 작업 시작 전 반드시 확인

## 나는 누구인가: 총괄 오케스트레이터 (Agent 00)

**이 규칙은 compacting 후에도, 세션이 바뀌어도 절대 변하지 않는다.**

### 절대 금지 (위반 시 작업 무효)
- ❌ Read / Edit / Write / Bash / Grep / Glob 도구 직접 사용
- ❌ 코드 파일 직접 읽기, 진단, 수정
- ❌ SQL 직접 실행
- ❌ 혼자서 문제 해결 시도

### 반드시 해야 하는 것
- ✅ 모든 작업은 Agent 도구로 서브에이전트에 위임
- ✅ 작업 전 반드시 `docs/agents/AGENT_00_orchestrator.md` 읽기
- ✅ 작업 전 반드시 `DESIGN_SYSTEM.md`, `AGENTS.md` 읽기
- ✅ 문제 발생 시 → 진단은 AGENT_13(테스터)에게, 수정은 해당 개발 에이전트에게 위임

### 세션 시작 시 체크리스트
1. [ ] 나는 오케스트레이터다 — 직접 코딩하지 않는다
2. [ ] AGENT_00_orchestrator.md 읽었는가?
3. [ ] 이번 작업을 어느 서브에이전트에게 위임할 것인가?

---

# ⚠️ 알림 시스템 핵심 규칙 (절대 위반 금지)

## 서버 푸시 알림 필수 사항

파킨온은 **환자-보호자 연동 알림 시스템**을 사용합니다. 아래 기능들은 **반드시 서버 푸시 알림**을 사용해야 하며, 절대로 로컬 알림으로 대체할 수 없습니다.

### 환자 → 보호자 알림 (Cross-user notifications)
1. **환자가 약 복용 기록** → 보호자에게 "💊 약을 드셨어요" 알림
2. **환자가 몸상태/기분 기록** → 보호자에게 알림
3. **환자가 운동 기록** → 보호자에게 "🏃 운동을 완료했어요" 알림
4. **환자가 약 미복용 (20분 경과)** → 보호자에게 "⚠️ 약을 아직 안 드셨어요" 알림

### 서버 → 환자 알림
1. **약 복용 시간 알림** (아침/점심/저녁/취침) - 서버 크론으로 전송
2. **약효 추적 알림** (복용 후 30분, 2시간 등) - 서버 큐로 전송
3. **운동 알림** - ~~현재 로컬 알림 사용 중~~ → **서버 푸시로 통일 필요**

## 기술 요구사항

- **Firebase Cloud Messaging (FCM)** 필수 설정
- `google-services.json` 파일 존재 (프로젝트 루트)
- EAS Build에 FCM 서버 키 업로드 필요
- 사용자의 `push_token` (Expo Push Token) DB 저장 필수
- 모든 cross-user 알림은 Edge Function 또는 서버 크론으로 전송

## 절대 금지 사항

❌ **"로컬 알림으로 바꾸면 된다"는 제안 절대 금지**
- 로컬 알림은 기기 내부에서만 작동
- 다른 사용자(보호자)에게 알림 전송 불가
- 환자-보호자 연동 기능이 완전히 망가짐

❌ **push_token 없이 작동 가능하다는 착각 금지**
- push_token이 null이면 모든 서버 푸시 알림 불가
- FCM 설정 없이는 Expo Push Token 발급 불가

⚠️ **알림 권한을 앱 이용 필수로 강제(하드 블록)하지 말 것 — iOS 심사 거부 위험**
- 파킨온은 iOS 출시 대상이다. 알림 권한 미허용 시 앱 자체를 막는 하드 게이트는 **App Store 심사에서 거부**될 수 있다.
- 안드로이드는 허용되더라도 iOS는 강제 금지 → **플랫폼별 분기 필요**(iOS는 권한 거부해도 앱을 계속 쓸 수 있게, 권한은 권유/재요청 수준으로).

## 디버깅 체크리스트

1. [ ] `users.push_token`이 null이 아닌지 확인
2. [ ] `google-services.json` 파일 존재 확인
3. [ ] FCM 서버 키가 EAS에 업로드되었는지 확인
4. [ ] 서버 크론/Edge Function이 정상 작동하는지 확인

---

# 파킨온 (ParkinON) - CLAUDE.md

## 프로젝트 개요

파킨슨 환자 + 보호자 연동 케어 앱.
약 복용 관리, 약효 추적, 몸 상태 기록, 가족 연동, 운동 기록, 커뮤니티 기능 제공.

**앱명**: 파킨온 (ParkinON)  
**회사**: 아워마인  
**플랫폼**: Android + iOS 양쪽 출시 대상 (React Native / Expo Managed Workflow)  
**타겟**: 파킨슨 환자 (60대 이상) + 보호자 (30대 이상)  

---

## 기술 스택

- **Frontend**: React Native / Expo (Managed Workflow)
- **Backend**: Supabase (Auth, DB, Realtime, Edge Functions)
- **Storage**: Cloudflare R2 (영상/사진)
- **알림**: Expo Notifications
- **처방전 OCR**: Claude API Vision (Haiku 모델)
- **의약품 정보**: 식품의약품안전처 공공 API + 낱알식별 API
- **뉴스 크롤링**: GitHub Actions (매일 자동)
- **로그인**: 카카오 OAuth (Android·iOS 공통). iOS 출시 대상이므로 Apple 로그인 추가 필요(App Store 심사 요건).

---

## UI 원칙 (60대 이상 타겟 - 절대 어기지 말 것)

- 글씨 최소 18sp 이상
- 버튼 최소 56dp 이상
- 한 화면에 정보 최대 2개
- 텍스트 입력 최소화 → 탭/선택 위주
- 고대비 색상
- 아이콘 + 텍스트 항상 함께
- **수정/삭제 버튼 통일 규칙 (2026-06-16 오너 확정, 최우선):** 수정/삭제 버튼은 **글자 버튼(텍스트 큰 버튼) 금지**. 오너가 따로 언급하지 않는 한, **알림 설정 슬롯의 수정/삭제 아이콘으로 통일** = `Ionicons create-outline`(수정, Colors.textSub) / `trash-outline`(삭제, Colors.danger), **아이콘만, 우측 배치**(참조: `src/components/settings/DoseSlotSetList.tsx:710·718`). (이 규칙이 위 "아이콘 단독 금지"보다 우선 — 수정/삭제에 한해 아이콘 단독 허용.)
- **바텀시트·하단버튼 안드 3버튼 잘림 방지 (2026-06-16 오너 확정, 글로벌·최우선):** 모든 바텀시트/모달/화면 하단 고정 버튼의 `paddingBottom` 은 **반드시** `useBottomSheetPadding()`(`src/hooks/useBottomSheetPadding.ts`, = `max(base, safeArea.bottom + 16)`) 값을 사용한다. `paddingBottom: 32` 같은 **하드코딩 금지** — 안드 3버튼 내비/홈 인디케이터에 가려 잘린다. 새 시트 만들 때도 이 훅 기본 적용. (오너가 "매번 발생한다"고 누차 지적 — 위반 시 반복 위반으로 간주.)
- 스와이프 제스처 최소화
- 작은 텍스트 링크 금지
- 굳이 한 화면에 다 안 나와도 됨 → 스크롤로 해결

---

## 앱 구조

### 탭바 (환자/보호자 동일)
```
💊 약복용   😊 몸상태   🏃 운동   📰 정보/나눔
```

### 상단 Topbar
- 햄버거 버튼 (≡) → 메뉴 화면

---

## 역할 구분

### 환자
- 약 복용 직접 입력
- 몸 상태 직접 입력
- 운동 직접 입력

### 보호자
- 함께 거주: 버튼 활성화 → 탭 시 "홍길동님 대신 입력하시나요?" 확인 팝업 후 입력
- 따로 거주: 버튼 비활성화 (회색) + "같이 계신 경우에만 대신 입력할 수 있어요" 안내

---

## 온보딩 흐름

### 공통
1. 온보딩 슬라이드 3장
2. 카카오 로그인
3. 역할 선택 (환자 / 보호자)
4. 가족 중 파킨온 사용자 확인 (코드 입력 or 스킵)

### 환자 온보딩
5. 기본 정보 4단계: 이름 → 출생연도 → 성별 → 진단연도
6. 약 등록: 처방전 사진(OCR) or 직접 입력
7. 약효 추적 알림 설정 (기본 ON)
8. 가족 초대 → 홈

### 보호자 온보딩
5. 기본 정보 3단계: 이름 → 출생연도 → 성별
6. 관계 선택 (배우자/자녀/형제/기타)
7. 거주 여부 (함께/따로)
8. 약 등록 (보호자 대신 가능)
9. 환자 초대 → 홈

---

## 알림 체계

### 약 복용 알림 흐름
```
복용 예정 시간 → 미입력 → 첫 알림
→ +10분 미입력 → 재알림
→ +10분 미입력 → 환자 알림 + 보호자 알림
```

### 약효 추적 알림
- 기본: 복용 후 30분, 2시간
- 커스터마이징 가능 (시간 변경/추가/삭제)
- 알림 통해 입력한 기록만 기록 보기 약효 패턴에 반영
- 수시 입력 기록은 약효 패턴에서 제외 (triggered_by 필드로 구분)

### 운동 팝업
- 몸 상태 4~5점 입력 시 → "몸 상태가 좋으시네요 😊 운동해보시겠어요?" 팝업

### 보호자 알림 (토글, 기본 ON)
- 약 복용했을 때
- 약효 상태 기록했을 때
- 운동 완료했을 때
- 약 미복용 알림 (20분 후)

---

## 화면별 핵심 설계

### 약복용 탭
- 메인: 날짜 + 💊 약 먹었어요 버튼 + 시간대별 복용 현황
- 버튼 탭 → 시간대 확인 → 저장 → 몸상태 팝업 진입
- 알림 진입 시 → 바로 시간대 확인 화면

### 몸상태 탭
- 메인: 날짜 + 😊 몸상태 기록하기 버튼 + 🎬 영상 기록하기 → + 시간대별 기록 리스트
- 영상 기록: 최대 2분, 촬영 or 갤러리, 미리보기 후 저장 → Cloudflare R2
- 팝업: 화면당 질문 하나 (몸상태 → 기분 → 수면(첫번째만) → 변비(마지막만))

### 운동 탭
- 메인: 날짜 + 🏃 운동 기록하기 버튼 + 📹 운동 영상 보기 → + 운동 기록 리스트
- 기본 4가지: 걷기/근력/균형/스트레칭 + 기타(자전거/수영/댄스/복싱/요가/조깅/직접입력)
- 시간 선택: 10~120분 선택지
- 운동 영상: parkinson.co.kr 기반, 기본/1단계/2단계/3단계/종합 탭

### 정보/나눔 탭
- 통합 피드: 크롤링 기사(📰 뱃지) + 사용자 게시글
- 리스트: 제목 + 작성자·날짜·조회수 + 썸네일(오른쪽) + 댓글수
- 글 유형: 💬자유수다 / ❓질문있어요 / 📢정보공유 / 💪운동인증 / 🙏응원해요
- 글쓰기 플로팅 버튼: 처음엔 ✏️ 글쓰기 텍스트+아이콘, 스크롤 내리면 아이콘만
- 사진 최대 5장, 영상은 유튜브 링크 붙여넣기
- 댓글/대댓글/좋아요 지원

---

## 메뉴 구조

```
← 메뉴
👤 홍길동 / 환자 / 프로필 수정 >
📊 기록 보기
⚙️ 설정
💊 약 관리
👨‍👩‍👧 가족 연동
📋 이용약관
🔒 개인정보처리방침
🚪 로그아웃
❌ 회원탈퇴
```

---

## 기록 보기

- 메인: 이번 주/이번 달/최근 3개월 탭 → 각 항목 현황 + 지난주/달/3개월 비교
- 항목: 💊약복용 / 😊몸상태(시간대별) / 😄기분(시간대별) / 😴수면 / 🚽변비 / 🏃운동
- 항목 탭 → 상세 화면: 현황 카드 + 트렌드 막대그래프 (이전/다음 버튼으로 과거 조회)
- 몸상태/기분: 복용직후/30분후/2시간후 각각 별도 트렌드
- 약효 추적 알림 통해 입력한 기록만 반영

---

## DB 테이블 목록

1. users
2. patient_groups
3. patient_group_members
4. medications
5. med_logs
6. on_off_logs (triggered_by 필드 필수: 'notification' | 'manual')
7. exercise_logs
8. symptom_notes
9. media_logs
10. news_feed
11. posts
12. comments
13. post_media

---

## 가족 연동 방식

- 초대 코드 방식 (6자리, 24시간 유효)
- 카카오톡으로 코드 자동 전송
- 각자 따로 가입한 경우 코드로 연동
- 딥링크 없음

---

## 처방전 OCR

- Claude API Vision (Haiku 모델)
- 개인정보 마스킹 후 분석
- 분석 결과만 저장, 원본 사진 즉시 삭제
- 식약처 API로 약 정보 매칭

---

## 영상 저장 정책

- 최대 2분 제한 (선택 즉시 duration 체크)
- 최대 압축 적용
- 저장: Cloudflare R2
- 경로: parkinon/videos/{patient_id}/{YYYY-MM}/
- 보관: 6개월 후 자동 삭제

---

## 미결 항목

- [ ] 에이전트 설계
- [ ] Apple 로그인 추가 (iOS 출시 대상 — App Store 심사 요건)

---

## 설계 문서 위치

- 전체 설계문서: 파킨온_설계문서.md
- 기록 보기 React: parkinon_records_v6.jsx
- 이용약관: terms.html
- 개인정보처리방침: privacy.html

---

## OTA 업데이트 원칙

파킨온은 EAS Update 기반 OTA(Over-The-Air) 업데이트가 구성되어 있다.  
**모든 개발 작업은 OTA 배포 가능 범위를 유지하는 방향으로 진행해야 한다.**

### OTA로 배포 가능한 변경 (앱스토어 재심사 불필요)
- JavaScript / TypeScript 코드 변경
- 화면 UI 수정, 버그 수정
- Supabase 쿼리, 로직 변경
- 텍스트, 색상, 레이아웃 변경
- 새 화면 추가 (네이티브 모듈 없는 경우)

### OTA 불가 — 반드시 앱스토어 재심사 필요
- 네이티브 모듈 추가/변경 (새 expo 플러그인, react-native 네이티브 패키지)
- app.json의 permissions, plugins 변경
- Android 네이티브 코드 변경 (android/ 폴더)
- Expo SDK 버전 업그레이드

### 배포 방식 (2026-04 수정)
- **⚠️ GitHub Actions 자동 배포 비활성화됨** — GitHub Actions 환경에 `.env`가 없어 Supabase URL이 undefined로 번들되어 앱 시작 즉시 크래시 발생. `ota-update.yml`을 `workflow_dispatch`로 변경.
- **수동 배포만 사용**: 맥북 로컬에서 `npx eas update --branch production --message "수정 내용" --non-interactive` 직접 실행
- `git push`는 코드 저장용, OTA 배포는 항상 별도로 수동 실행할 것

### 개발 시 주의사항
- 새 패키지 추가 시 네이티브 모듈 포함 여부를 반드시 확인할 것
- 네이티브 모듈이 포함된 패키지는 OTA 불가 → 새 APK 빌드 필요
- `runtimeVersion`은 `appVersion` 정책 사용 중 → app.json의 `version` 변경 시 기존 OTA와 호환 끊김 주의

---

### ⚠️ OTA가 작동하려면 APK가 올바르게 빌드되어야 한다 (2026-04 사고 분석)

**어제 OTA가 안 됐던 원인:**
4월 15일 빌드된 APK는 `app.json`에 `expo.updates` 설정 자체가 없이 빌드됨.
네이티브 레벨(AndroidManifest.xml)에 `ENABLED=false`, EAS URL 없음 → 앱이 OTA를 아예 체크하지 않았음.
JS 코드에서 `checkForUpdateAsync`를 아무리 호출해도 네이티브가 비활성화면 작동 안 함.

**지금 OTA가 되는 이유:**
새 APK(`build-1776610644306.apk`, 2026-04-20 로컬 빌드)에 아래 설정이 반영됨:
- `app.json` → `expo.updates.enabled: true`
- `app.json` → `expo.updates.url`: EAS Update 엔드포인트
- `app.json` → `expo.updates.checkAutomatically: "ON_LOAD"`
- `App.tsx` → 앱 시작 시 `checkForUpdateAsync` + `fetchUpdateAsync` + `reloadAsync` 코드

**핵심 규칙:**
1. `app.json`의 `expo.updates` 설정을 절대 삭제하거나 `enabled: false`로 바꾸지 말 것
2. `App.tsx`의 OTA 체크 코드(`checkForUpdateAsync`)를 절대 삭제하지 말 것
3. OTA 작동 여부는 **앱 완전 종료 후 재실행**으로만 확인 가능 (백그라운드 상태에서는 업데이트 미적용)
4. `expo prebuild --clean` 없이 `app.json`만 수정해도 네이티브에 반영 안 됨 → APK 재빌드 시 반드시 `expo prebuild --clean` 선행

**OTA 작동 여부 빠른 확인법:**
```
npx expo run:android 로 빌드된 android/app/build/intermediates/merged_manifests 또는
android/app/src/main/AndroidManifest.xml 에서 아래 항목 확인:
- expo.modules.updates.ENABLED = true
- expo.modules.updates.EXPO_UPDATE_URL = (URL 존재)
- expo.modules.updates.EXPO_RUNTIME_VERSION = 1.0.0
```

**APK 재빌드가 필요한 경우 (OTA 불가):**
위 AndroidManifest 항목 중 하나라도 잘못되어 있으면 JS 코드 수정만으로는 OTA 복구 불가 → 반드시 APK 재빌드
