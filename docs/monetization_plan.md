# 파킨온 수익화(구독+광고) 실행 계획

작성: 2026-07-04. 배경·근거는 [overseas_expansion_review.md](./overseas_expansion_review.md), [overseas_execution_plan.md](./overseas_execution_plan.md) Phase 5~7 참조.

## Context

해외(영어권) 출시를 위한 Phase 1(타임존)·Phase 4(법률/동의)까지 완료된 상태. 남은 건 오너가 확정한 **"C안"(다운로드 무료 + 구독 + 광고)** 수익화뿐이다. 구독의 심사 명분은 "광고 제거"가 아니라 **"클라우드 저장 확장"(SaaS)**이어야 Apple 자동갱신 구독 심사를 통과한다(광고 제거만으로는 거부됨). 구독·광고 SDK 모두 네이티브 모듈이라 **재빌드 1회가 반드시 필요**하며, 그 시점에 그동안 미뤄둔 앱 이름(파킨온→영문명, iOS/Android 표시명) 교체도 함께 반영한다.

코드베이스 탐색 결과 이 영역은 **완전히 그린필드**다 — IAP/구독/광고 관련 코드가 전혀 없고, 미디어 보관기간(`media_logs.expires_at`, 업로드 시 +6개월로 고정 세팅)도 **실제로 삭제를 실행하는 코드가 어디에도 없다**(주석에 "R2 lifecycle rule"이라 적혀 있지만 리포에서 확인 불가 — 사실상 방치된 상태). 이건 "구독=저장 용량/기간" 명분을 구현하려면 어차피 새로 만들어야 하는 부분이라, 수익화 작업과 자연스럽게 묶어서 처리한다.

**광고 배치 원칙 관련(2026-07-04 정정)**: 이전에 "핵심 복약/기록 화면 제외, 정보·커뮤니티 탭에만"이라는 원칙이 기록돼 있었으나, 오너가 "그런 결정 한 적 없다"고 정정 — **해외는 수익화 우선이며, 광고를 특정 화면에서 배제하지 않는다.** 다만 "마구잡이"는 안 된다는 지시에 따라 아래 절제된 배치안(배너 전용, 화면당 1개, 핵심 조작 버튼과 분리된 고정 위치)을 적용한다.

---

## Phase 5 — 수익화 백엔드 설계 (OTA 가능, 재빌드 불필요)

### 5.1 DB 스키마
- `users`에 컬럼 추가: `subscription_tier text NOT NULL DEFAULT 'free'` (`'free' | 'premium'`), `subscription_expires_at timestamptz`, `revenuecat_synced_at timestamptz`(디버깅용, 선택).
- RevenueCat의 `appUserID`는 Supabase `users.id`를 그대로 사용(별도 매핑 테이블 불필요, RevenueCat 대시보드에서 그대로 조회 가능).

### 5.2 저장 티어 정의 (숫자는 오너가 스토어 등록 전 확정 — 구조는 지금 확정)
바이트 단위 정밀 계량은 하지 않는다(`media_logs`에 파일 크기 컬럼이 없고, 새로 추가하는 것보다 **개수+기간** 기준이 심사·구현 모두 단순하고 "확실히 늘어난 저장"으로 충분히 어필됨):
- Free: 보관기간 3개월, 활성 미디어 최대 50개(사진·영상 합산)
- Premium: 보관기간 24개월(또는 "구독 유지 중 무제한"), 활성 미디어 최대 500개(또는 무제한)
- 광고 제거는 프리미엄의 **부가 혜택**으로만 마케팅(구독 심사 뼈대 아님).

### 5.3 업로드 시 티어 반영
- `src/lib/r2Upload.ts`의 `calcExpiresAt()`(현재 전원 +6개월 고정, r2Upload.ts:49-54)을 사용자 `subscription_tier`를 인자로 받아 free=3개월/premium=24개월로 분기하도록 수정.
- 업로드 전 quota 체크: 해당 patient의 활성 `media_logs`(expires_at > now()) COUNT가 티어 한도 이상이면 업로드 차단 + "저장 공간이 가득 찼어요 → 구독하고 늘리기" 유도 다이얼로그(신규 `useDialog` 활용, 기존 패턴 재사용).

### 5.4 실제 보관기간 만료 삭제(신규 — 지금까지 없던 기능)
- 신규 Supabase Edge Function `expire-media`: `media_logs`에서 `expires_at < now()`인 행을 찾아 R2 오브젝트 삭제(`delete-r2-file`과 동일한 삭제 로직 재사용) 후 행 삭제. pg_cron으로 매일 1회 실행(기존 `cron_http_post_timeout_30s.sql` 패턴 참고).
- **구독 취소 시 즉시삭제 금지 원칙**: 이미 올린 파일의 `expires_at`은 업로드 당시 티어 기준으로 이미 고정돼 있으므로 별도 처리 불필요(취소해도 소급 단축 안 함) — 오직 신규 업로드만 free 한도로 즉시 차단됨. 이게 곧 "유예기간 읽기전용"에 해당.

### 5.5 광고 배치 설계 (배너 전용, 화면당 1개, 고정 위치)
후보 화면(핵심 화면 포함, 배제 없음 — 오너 지시 반영): 약복용/몸상태/운동 메인 탭 하단, 기록 보기(RecordsScreen), 해외 전용 "약 관리" 탭(OverseasMedTabScreen). 배치 원칙(60대+ UX 최소 안전장치, "마구잡이" 방지용):
- 배너만(전면/삽입형 광고 없음), 화면당 정확히 1개.
- 핵심 조작 버튼(예: "약 먹었어요" 버튼)과 최소 한 뼘 이상 띄운 고정 위치 — 우발적 터치 방지.
- 비개인화(`npa=1`) 고정, 건강데이터 광고 SDK 미전달(기존 방침 유지).
- 온보딩·동의 화면·다이어리(정서적 화면)는 광고 제외.

---

## Phase 6 — 수익화 통합 (⚠️ 네이티브 재빌드 1회 필요)

### 6.1 IAP 구독 — RevenueCat 채택
- 이유: 영수증 검증·구독 상태 서버 동기화를 자체 구현하지 않아도 됨(webhook 하나로 해결), `react-native-purchases` SDK 성숙도 높음, 무료 티어(MTR $2.5k 이하)로 이 단계 비용 0.
- `revenuecat-webhook` Edge Function 신규: RevenueCat이 구매/갱신/취소/만료 이벤트를 보내면 `users.subscription_tier`/`subscription_expires_at` 갱신(기존 `kakao-auth` 류 webhook 패턴과 동일 구조).
- 클라: `src/hooks/useSubscription.ts` 신규(user.subscription_tier 기반 `isPremium` 노출) + `SubscriptionManageScreen.tsx` 신규(메뉴 `sectionManage`에 추가, `MenuNavigator`에 라우트 추가 — 기존 메뉴 항목 추가 패턴과 동일).
- 페이월 UI는 RevenueCat 기본 템플릿 대신 **자체 제작**(이 앱의 큰 버튼·18sp+ 텍스트·고대비 디자인 시스템 일관성 유지 목적).

### 6.2 광고 SDK — `react-native-google-mobile-ads`(AdMob)
- 배너만 통합(위 5.5 설계). 인터스티셜/네이티브 광고는 이번 범위 밖(추후 검토).
- iOS: ATT 프롬프트 + `NSUserTrackingUsageDescription`(app.json에 없음, 신규 추가) + `SKAdNetworkItems` + `GADApplicationIdentifier`.
- Android: `AD_ID` 권한 재도입(GMA SDK가 자동 병합하나 명시 확인) + Play 콘솔 광고ID 선언.
- `app.json`의 `expo.plugins`(현재 9개, ads/iap 플러그인 없음)에 `react-native-google-mobile-ads`, `react-native-purchases`(플러그인 필요시) 추가.

### 6.3 재빌드 시 함께 반영 (누락 방지 체크리스트, 기존 메모 항목)
- `app.json` `expo.name` "파킨온" → 영문명 교체(로케일 분기 또는 고정 영문명, 오너 확정 필요).
- iOS App Privacy 라벨 / Android Play Data Safety 재선언(광고ID·추적 반영).
- EAS Build 새 빌드(Android+iOS) 1회.

---

## Phase 7 — 사업자 세팅 / 스토어 출시 (엔지니어링 외 — 오너 액션)

- Apple: 유료 앱 계약(Paid Apps Agreement) + 은행 계좌 + 세금 서식(W-8BEN, 비거주자).
- Google: 결제 프로필 + 은행 + 세금 정보.
- 구독 상품 스토어 등록(App Store Connect / Play Console) — 명칭·가격(오너 확정), 심사 설명은 "클라우드 저장 확장"을 뼈대로 작성.
- 스토어 등록정보 영어화(앱 설명/키워드/스크린샷 영어 UI로 재캡처).
- 배포국가: 미국·영국·캐나다·호주·아일랜드·뉴질랜드.
- Google 2026-06-30 요금구조 변경분 반영해 최종 가격 확정 후 제출.

---

## 진행 순서
1. **지금 시작 가능**(OTA, 재빌드 불필요): Phase 5 전체 — DB 마이그레이션 + `calcExpiresAt` 티어 분기 + 업로드 quota 체크 + `expire-media` 크론 + `SubscriptionManageScreen`(구독 상태 표시만, 실제 결제 버튼은 6단계 완료 전까지 "준비 중" 처리 가능) + 광고 배치용 UI 자리(빈 슬롯, SDK는 6단계에서).
2. Phase 5 완료·검증 후 → Phase 6(재빌드) 착수. RevenueCat 계정 생성, AdMob 계정 생성은 오너가 먼저 해줘야 진행 가능(계정 생성은 엔지니어링 범위 밖).
3. Phase 6 빌드 완료 후 → Phase 7(오너 주도, 사업자 세팅·스토어 등록).

## 검증 방법
- Phase 5: `npx tsc --noEmit` 통과 + Supabase에서 마이그레이션/Edge Function 직접 테스트(테스트 계정으로 quota 초과 업로드 차단 확인, `expire-media` 수동 호출로 만료 삭제 확인).
- Phase 6: EAS 개발 빌드로 실기기에서 배너 노출 확인 + RevenueCat 대시보드에서 테스트 구매(Sandbox) → `users.subscription_tier` 갱신 확인.
- Phase 7: 스토어 심사 제출 전 체크리스트(App Privacy 라벨, 구독 설명 문구) 재확인.

## 선행 확인 필요(오너 결정 대기)
- 저장 티어 구체 숫자(3개월/50개, 24개월/500개는 제안 초안 — 확정 필요)
- 구독 가격(월/연)
- 앱 영문명(app.json expo.name)
- RevenueCat/AdMob 계정 생성(오너가 직접, 이후 API 키를 Supabase/EAS 시크릿에 전달)
