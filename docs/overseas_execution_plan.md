# 파킨온 해외 진출 실행 계획 (Phase 순서)

작성 2026-07-02. 배경·근거는 [overseas_expansion_review.md](./overseas_expansion_review.md) 참조.
목표: **영어권 1차 출시** (미국·영국·캐나다·호주 등) — 다운로드 무료 + 구독 + 광고(C안).

## 진행 원칙
- Phase 순서대로 하나씩. 앞 Phase가 끝나야 다음이 자연스럽게 이어짐.
- **네이티브 재빌드가 필요한 작업(광고 SDK·IAP 구독)은 Phase 6에 몰아서 재빌드 1회.** Phase 1~4는 전부 OTA로 배포·반복 가능.
- 각 Phase는 국내 앱을 깨지 않게(회귀 없이) 진행. 특히 서버/DB 변경은 국내 라이브에 영향 주의.

---

## Phase 1 — 타임존 기반 (환자 안전 최우선) ✅ 완료(2026-07-04)
해외 사용자의 약 알림이 올바른 현지 시각에 울리게. 이거 없으면 해외 출시 자체가 위험.
- [x] `users.timezone`(IANA 문자열) 컬럼 추가 (마이그레이션, DEFAULT 'Asia/Seoul')
- [x] 앱 부팅 시 `Intl.DateTimeFormat().resolvedOptions().timeZone`으로 기기 타임존 자동 감지 → 저장 (네이티브 재빌드 불필요, `src/utils/timezone.ts`)
- [x] 서버 크론 재작성: `send-medication-reminders`(신규 `get_meds_due` tz-aware RPC로 전환) / `send-missed-med-reminders`(환자별 하루경계) / `send-appointment-reminders`(표시 시각만 tz화, 트리거는 원래도 tz-safe)
- [x] 클라 하루 경계 KST 제거: `getLocalToday`/`getLocalDayRange`(tz 인자) 신설 + `getKSTToday`/`getKSTDayRange`는 하위호환 래퍼로 유지, useMedication/useBodyState/useExercise/HistoryTimeline/notifActionFeedback 전부 `user.timezone` 사용하도록 전환
- [x] 국내(KST) 사용자 회귀 없음 검증: `get_meds_due(0)` vs `get_meds_at_time` 실제 슬롯으로 동일 patient_id 반환 확인, localDayRangeUtc가 기존 `+09:00` 하드코딩과 비트 동일 계산됨을 수식 검증
- 참고: 약효추적 큐는 UTC 절대오프셋이라 변경 불필요(무손 확인).

## Phase 2 — 다국어 뼈대 + 영어화
- [ ] i18n 프레임워크 도입 (react-i18next + expo-localization), Provider/훅 세팅
- [ ] UI 문자열 추출 → 키 카탈로그화 (뷰 + hooks + utils + constants 전부)
- [ ] 영어 번역 (의료 용어 정확히)
- [ ] 날짜/시간/숫자 로케일 포맷 정리 (하드코딩 `ko-KR`·오전/오후·요일배열 제거)
- [ ] 서버 알림 문자열 로케일화: 수신자 언어를 DB에 저장 + Edge Function 템플릿을 언어별로
- 기기 언어에 따라 한국어/영어 자동 전환되게 (국내 사용자는 계속 한국어)

## Phase 3 — 해외용 기능 조정 (OTA 가능)
- [ ] 카카오 로그인 버튼 로케일 게이트: 해외에선 숨기고 Apple/Google만 노출 (네이티브 카카오는 유지 → OTA 가능)
- [ ] 초대 카톡 공유(`FamilyLinkScreen`/`FamilyInviteScreen`) → 해외는 일반 시스템 공유로
- [ ] 식약처 약검색 숨김 (수동 입력만 남김, "출처: 식약처" 라벨 제거). 약효추적 추천엔진은 국제 공통 약명 기반이라 무변경
- [ ] 운동영상: 해외 로케일에선 탭 숨김 (콘텐츠 소싱은 후순위 or 제외)

## Phase 4 — 법률 / 동의
- [ ] 약관·개인정보처리방침 영어판 작성 + parkinon.com 로케일 라우팅
- [ ] 명시적 동의 UI: 건강데이터 처리 별도 동의 + 국외이전(서울 저장 + Anthropic 미국 OCR) 고지
- [ ] 계정 삭제·데이터 권리(열람/삭제) 안내 영어화
- [ ] 앱 내 의료 면책 문구 영어 (진단·치료 아님)

## Phase 5 — 수익화 백엔드 / 설계 (재빌드 전 준비, OTA 가능) — 상세 계획: `docs/monetization_plan.md`
- [ ] 저장 용량·보관기간 티어 데이터모델 + 서버 enforce (무료 한도 vs 구독 한도) — `users.subscription_tier`, 개수+기간 기준(free 3개월/50개, premium 24개월/500개, 오너 확정 대기)
- [ ] 구독 취소 시 기존 미디어 즉시삭제 금지 → 유예기간 읽기전용 로직 — 업로드 시점 티어로 `expires_at` 고정, 취소해도 소급 단축 안 함
- [ ] 신규: 만료 미디어 실제 삭제 크론(`expire-media` Edge Function, 지금까지 미구현 상태였음)
- [ ] 구독 상품 정의: 자동갱신 구독, **심사 뼈대 = 클라우드 저장(용량+기간)**, 광고 제거는 부가 혜택
- [ ] 광고 배치 설계(2026-07-04 정정 — 화면 배제 없음, 해외는 수익화 우선): 배너 전용·화면당 1개·핵심 버튼과 분리된 고정 위치. 비개인화(`npa=1`), 건강데이터 광고 SDK 미전달

## Phase 6 — 수익화 통합 (⚠️ 네이티브 재빌드 1회)
- [ ] IAP 구독 통합 (RevenueCat 등) + 구독 상태 ↔ 저장 티어 연동
- [ ] 광고 SDK(AdMob / react-native-google-mobile-ads) 통합 + 비개인화 + (EU용) 동의 게이트
- [ ] iOS: ATT 프롬프트 + NSUserTrackingUsageDescription, SKAdNetworkItems, GADApplicationIdentifier
- [ ] Android: AD_ID 권한 재도입 확인 + Play 광고ID 선언
- [ ] EAS Build 새 빌드 (안드/iOS)
- [ ] iOS App Privacy 라벨 / Play Data Safety 재선언 (광고 ID·추적 반영)

## Phase 7 — 사업자 / 스토어 출시
- [ ] 사업자 판매자 세팅: Apple 유료 앱 계약 + 은행 계좌 + 세금 서식(W-8BEN), Google 결제 프로필 + 세금
- [ ] 스토어 등록정보 영어: 앱 이름/설명/키워드/스크린샷(영어 UI로 재캡처)
- [ ] 배포 국가: 영어권(미국·영국·캐나다·호주·아일랜드·뉴질랜드 등) 선택
- [ ] 구독 상품·가격 스토어 등록 (Apple 소규모 프로그램 15%, Google 요금 구조 2026-06-30 변경 반영)
- [ ] 심사 제출 → 출시

---

## 이후 (2차·3차)
- 2차: 일본어 현지화 → 일본 (약DB=PMDA 없음, KEGG 유료 / 개호보험 문화)
- 3차: 독일/EU (GDPR 명시적 동의·EU 대리인·DSA 커뮤니티 의무·DiGA 급여 검토)
- 약DB 현지화(원할 때): 파킨슨약(ATC N04) 화이트리스트 마스터 + 국가별 로컬코드 매핑 (RxNorm 허브)
