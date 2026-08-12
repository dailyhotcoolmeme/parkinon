# 파킨온 해외 진출 실행 계획 (Phase 순서)

작성 2026-07-02 · **전면 갱신 2026-08-12**. 배경·근거는 [overseas_expansion_review.md](./overseas_expansion_review.md) 참조.

---

## 🚨 이 문서를 읽기 전에 (2026-08-12 정정)

**이 문서는 2026-07-02 작성 이후 한 번도 갱신되지 않아, 오랫동안 실제와 크게 어긋나 있었다.**
거의 모든 항목이 `[ ]` 로 남아 있었지만 실제로는 **이미 6개국에 출시 완료**된 상태였다.
실제로 이 문서 때문에 "영어 스토어 스크린샷이 아직 없다"고 잘못 판단한 일이 있었다(2026-08-12).

**정정된 사실 두 가지:**

1. **배포 국가는 "영어권"이 아니라 6개국이다. 영국·아일랜드는 의도적 제외다**(오너 재확인 2026-08-12).
   예전 본문은 "영어권 1차 출시 (미국·**영국**·캐나다·호주 등)", "배포 국가: 영어권(…·**아일랜드**·…)"
   라고 적고 있었다. EEA/UK 는 GDPR·EU 대리인 등 제약이 커서 뺀 것이다. CLAUDE.md 의
   "계획 문서를 근거로 유럽 대응을 판단하지 말 것" 경고가 가리키는 문서가 **바로 이 파일이었다.**
2. **Phase 2~7 은 대부분 완료됐다.** 아래 표시는 2026-08-12에 실제 코드·스토어를 대조해 붙인 것이다.

### 실제 출시 현황 (2026-08-12, App Store 조회로 확인)

| 스토어 | 상태 | 앱 이름 | 스크린샷 |
|---|---|---|---|
| 한국 | 출시 v1.0.4 | 파킨온 | 9장 |
| 미국 | 출시 v1.0.4 | ParkinON | 6장(영어) |
| 일본 | 출시 v1.0.4 | パーキンオン | 5장(일본어) |
| 캐나다 | 출시 v1.0.4 | ParkinON | 6장 |
| 호주 | 출시 v1.0.4 | ParkinON | 6장 |
| 뉴질랜드 | 출시 v1.0.4 | ParkinON | 6장 |
| 영국·아일랜드·독일 | **미출시(의도적)** | — | — |

앱 지원 언어: `ko / en / fr / ja`. **프랑스는 출시국이 아니다** — 프랑스어는 캐나다(퀘벡)용이다.

---

## 🔴 아직 안 된 것 (여기부터 보면 된다)

### 1. 녹음 알림음 6개월 자동 삭제 크론 — 미구현 (공표한 약속)
해외판 약관 제11조 ⑥ / 개인정보처리방침 제3조에 **"구독 종료일로부터 6개월 뒤 자동 삭제"**
라고 이미 공표했는데 삭제 로직이 없다. 상세·착수 조건은 **CLAUDE.md 최상단**에 있다(그쪽이 정본).
- 확인 결과(2026-08-12): `supabase/functions/` 26개 중 해당 크론 없음. `cron.schedule` 은
  마이그레이션 어디에도 없음. `20260709000000_reset_group_custom_sounds_on_downgrade.sql` 은
  **참조만 해제**하고 `custom_sounds` 행·R2 원본은 지우지 않는다(그 파일 2행에 명시).

### 2. 마이그레이션 없이 대시보드에서 적용된 컬럼들 — 저장소로 스키마 재현 불가
`supabase/migrations/` 에 정의가 없는데 코드가 의존하는 컬럼들:
- `users.language`, `users.country` — 서버 알림 언어 선택이 여기 의존(에지 함수 ~7개)
- `patient_groups.subscription_tier` / `subscription_expires_at` / `subscription_payer_user_id` / `revenuecat_synced_at`
- `users.sensitive_info_consented` / `international_transfer_consented` (+ 각 version)

→ 새 환경을 만들면 앱이 깨진다. 뒤늦게라도 마이그레이션으로 적어 둘 것.

### 3. 구독 UI에서 연간 상품·무료체험을 고를 수 없다
`SubscriptionManageScreen.tsx` 가 `packageType === 'MONTHLY'` 를 찾고 없으면 `packages[0]` 로
떨어져서, 실질적으로 **월 상품 하나만 구매 가능**하다. `getTrialInfo()` 는 있는데 진입 경로가 없다.
(가격 결정 자체는 `monetization_plan.md:45` — 월 $4.99 / 연 $39.99 + 연간 7일 트라이얼)

### 4. Play 광고 ID 선언(Data Safety) — 저장소에서 확인 불가
콘솔 입력 항목이라 코드로는 알 수 없다. 실제 제출 여부만 콘솔에서 확인하면 된다.

---

## Phase 1 — 타임존 기반 ✅ 완료(2026-07-04)
해외 사용자의 약 알림이 올바른 현지 시각에 울리게.
- [x] `users.timezone`(IANA) 컬럼 + 앱 부팅 시 기기 타임존 자동 감지(`src/utils/timezone.ts`)
- [x] 서버 크론 tz-aware 전환(`get_meds_due` RPC 등), 클라 하루 경계 KST 제거
- [x] 국내(KST) 회귀 없음 검증
- 약효추적 큐는 UTC 절대오프셋이라 변경 불필요.

## Phase 2 — 다국어 뼈대 + 영어화 ✅ 완료
- [x] i18n 프레임워크 — `i18next` + `react-i18next` (`src/i18n/index.ts:35-51`).
      ⚠️ **`expo-localization` 은 일부러 안 쓴다** — `Intl` 기반 감지라 OTA 로 배포 가능
      (`src/i18n/detectLocale.ts`). 계획 원안과 다르지만 이게 맞는 선택이었다.
- [x] UI 문자열 카탈로그화 — `src/i18n/locales/{ko,en,fr,ja}.json`, **각 2018키로 전부 동일**(누락 0)
- [x] 영어 번역
- [x] 날짜/시간/숫자 로케일 포맷 — `displayLocaleTag()`(`detectLocale.ts:137-140`) 경유.
      하드코딩 `ko-KR`·`오전/오후` 잔재는 주석·레거시 상수뿐
- [x] 서버 알림 문자열 로케일화 — `supabase/functions/_shared/i18n.ts` 에 4개 언어 템플릿,
      수신자별 `language` 로 분기(`send-medication-reminders`·`send-missed-med-reminders`·
      `send-appointment-reminders`·`process-notification-queue` 등)
- 기기 언어 기준 자동 전환(앱 내 언어 전환 스위치는 없음 — `changeLanguage` 호출부 없음)

## Phase 3 — 해외용 기능 조정 ✅ 완료 (1건은 원안과 다르게 처리)
판정 기준 함수: `isOverseasLocale()` = `!isKoreanLocale()` (`src/i18n/detectLocale.ts:108-118`).
**기기 "언어" 기준이지 지역 기준이 아니다** — 한국어 폰이면 미국에 있어도 국내로 본다.
- [x] 카카오 로그인 해외 숨김 (`LoginScreen.tsx:41,240-259`) — 해외는 Apple/Google 만
- [x] 초대 공유 → 시스템 공유 (`FamilyLinkScreen`/`FamilyInviteScreen` 모두 RN `Share.share`)
- [x] 식약처 약검색 해외 숨김 (`MedicationManageScreen.tsx:262-264` 외 6곳)
- [~] 운동: **영상은 숨겼고 탭은 남겼다** (`ExerciseScreen.tsx:290-299`).
      원안은 "탭 숨김"이었으나 실제로는 탭 유지 + 영상 진입점만 제거. 해외에서 바뀌는 탭은
      정보·나눔(Feed) → `OverseasMedTab` 이다(`MainNavigator.tsx:56-58`). 원안대로 되돌릴 필요는
      없어 보이지만, "탭 숨김"으로 적혀 있던 것과 다르다는 점만 기록해 둔다.

## Phase 4 — 법률 / 동의 ✅ 완료 (1건 조건부)
- [x] 약관·개인정보처리방침 영어·프랑스어·일본어판 — `parkinon-web/public/{terms,privacy}/{en,fr,ja}/`
      앱에서 `legalDocUrl()`(`detectLocale.ts:149-154`)로 언어별 주소를 연다
- [x] 명시적 동의 UI — `SensitiveInfoConsentScreen.tsx`(건강정보 + 국외이전 별도 동의, 각각 버전 관리)
- [x] 계정 삭제·데이터 권리 안내 영어화
- [~] 앱 내 의료 면책 영어화 — 복약 관련은 번역됐으나 **컨디션 측정(디지털 바이오마커) 화면의
      면책 문구는 한국어 하드코딩**(`MeasurementResultScreen`·`ConsentScreen` 등).
      지금은 `MEASUREMENT_FEATURE_ENABLED = false`(`constants/featureFlags.ts:11`)라 노출되지 않는다.
      **이 플래그를 켜기 전에 반드시 번역할 것.**

## Phase 5 — 수익화 백엔드 / 저장 티어 ✅ 완료 (원안과 설계가 달라짐)
- [x] 티어 데이터모델 — `patient_groups.subscription_tier`(`free`/`premium`). **users 가 아니라 그룹 단위다.**
- [x] 서버 enforce — `r2-upload/index.ts:155-222`. 단 서버는 **어뷰징 상한**만 막고,
      실제 UX 한도(무료 하루 사진5·영상2·음성1, `lib/mediaQuota.ts:18-22`)는 클라이언트가 건다.
- [x] 취소 시 즉시삭제 금지 — 다운그레이드해도 미디어·녹음을 지우지 않는다
      (`20260709000000_...sql:2` 에 명시)
- [ ] ~~보관기간 티어(무료 3개월/50개, 프리미엄 24개월/500개)~~ — **폐기됨.** 개수/일 단위로 대체됐다.
- [ ] ~~만료 미디어 삭제 크론(`expire-media`)~~ — **의도적으로 만들지 않기로 결정**
      (`monetization_plan.md:58` "구현하지 않는다").
      ⚠️ 다만 `media_logs.expires_at` 에는 아직 업로드 시점 +6개월이 계속 기록된다
      (`lib/r2Upload.ts:50-55`). 아무도 이 값을 쓰지 않는 **죽은 데이터**이고,
      같은 파일 184행 주석은 "6개월 후 자동 삭제"라고 사실과 다르게 적혀 있다. 정리 필요.
- [x] 광고 배치 — 배너/네이티브 6곳, 비개인화(`npa=1`) 고정

## Phase 6 — 수익화 통합 ✅ 완료 (ATT 는 원안과 다르게 결론)
- [x] IAP 구독 — **RevenueCat**(`react-native-purchases`). 구독 상태 ↔ 티어 연동을 서버에서 3중으로:
      웹훅(`revenuecat-webhook`) + 온디맨드(`sync-subscription`) + 환불 보정(`reconcile-refunds`)
- [x] 광고 SDK — `react-native-google-mobile-ads`, AdMob 앱 ID 안드/iOS 양쪽 네이티브 반영 완료
- [~] iOS ATT — `SKAdNetworkItems` 48개는 있으나 **ATT 프롬프트와 `NSUserTrackingUsageDescription`
      은 일부러 없다.** 비개인화 광고만 쓰므로 IDFA 접근이 없어 ATT 가 필요 없다는 판단
      (`src/lib/ads.ts:4`). 원안에는 ATT 를 넣게 돼 있었으나 **현재 방침이 맞다**고 본다.
- [x] Android AD_ID — 광고 SDK 매니페스트 병합으로 최종 APK 에 포함됨
- [x] EAS 새 빌드 → v1.0.4 (buildNumber 10 / versionCode 8)
- [x] iOS App Privacy / Play Data Safety 재선언 (광고 ID 반영) — Play 쪽만 콘솔 확인 필요(위 🔴 4번)

## Phase 7 — 사업자 / 스토어 출시 ✅ 완료
- [x] 사업자 판매자 세팅(Apple 유료 앱 계약·세금 서식, Google 결제 프로필)
- [x] 스토어 등록정보 영어·일본어 — **영어 스크린샷 6장, 일본어 5장 이미 게재 중**
      (파일명이 `01_medications.png` 식이라 국문판 `parkinon1_ios.png` 와 다르다.
      웹사이트 영어판 앱 홍보 블록도 이 스토어 이미지를 그대로 쓴다 —
      `parkinon-web/site/src/assets/images/appshots/en/`)
- [x] 배포 국가: **한국·미국·일본·캐나다·호주·뉴질랜드 6개국.** 영국·아일랜드는 제외(오너 확정)
- [x] 구독 상품·가격 스토어 등록 — 단 앱 UI 에서 연간·트라이얼 선택 불가(위 🔴 3번)
- [x] 심사 제출 → 출시 (전 스토어 v1.0.4)

---

## 이후 (2차·3차)
- ~~2차: 일본어 현지화 → 일본~~ → **이미 완료**(일본 출시, 일본어 스토어 등록까지)
- 다음 후보: 독일/EU (GDPR 명시적 동의·EU 대리인·DSA 커뮤니티 의무·DiGA 급여 검토).
  **수익이 대리인 비용을 감당할 수 있을 때** 착수한다(CLAUDE.md "확장 여지" 절 참고).
- 약DB 현지화(원할 때): 파킨슨약(ATC N04) 화이트리스트 + 국가별 로컬코드 매핑 (RxNorm 허브)

---

## ⚠️ 이 문서를 다시 낡게 만들지 않으려면
- 스토어에 뭔가 올리거나 국가를 바꾸면 **그날 이 표를 고친다.**
- 상태가 궁금하면 이 문서보다 **실제를 먼저 본다.** 출시 현황은 아래 한 줄로 확인된다:
  ```
  curl -s "https://itunes.apple.com/lookup?id=6773573590&country=us" | python3 -m json.tool
  ```
- `docs/i18n_*.md` 는 **일회성 스캔 결과**지 현황이 아니다. 이미 고쳐진 항목이 그대로 남아 있다.
