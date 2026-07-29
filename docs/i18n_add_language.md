# 언어 추가 체크리스트

새 언어를 붙일 때 건드릴 곳은 정해져 있다. 아래 순서대로 하면 앱·서버·검사기가
자동으로 따라온다. (2026-07-29 프랑스어·일본어 추가하며 확정)

---

## 1. 앱 문자열 (필수)

1. `src/i18n/locales/<lang>.json` 생성
   - 원본은 **`ko.json`** 이다(1,881개 키). 영어는 이미 번역된 결과물일 뿐이라
     기준으로 삼지 않는다. 다만 실무에선 `en.json` 을 보고 옮기는 쪽이 빠르다.
   - 한 번에 다 쓰지 말 것. 네임스페이스 단위로 조각을 만들어 병합한다:
     ```
     node scripts/i18n-merge.mjs <lang> /tmp/part.json
     ```
     조각마다 JSON 유효성이 보장되고, 중간에 검사기를 돌려볼 수 있다.
     병합 시 키 순서는 `ko.json` 기준으로 재정렬돼 diff 가 읽힌다.

2. `src/i18n/detectLocale.ts` → `SUPPORTED_LANGUAGES` 에 코드 추가
3. `src/i18n/index.ts` → `resources` 에 한 줄 추가

이 셋이면 앱은 끝이다. 화면 코드는 건드릴 게 없다.

### 진단용 문자열은 영어로 남긴다
`r2Upload.presignedUrlFailError`, `familyLinkHook.*FailError`,
`groupMembership.*` 처럼 **사용자가 아니라 우리가 읽는** 문자열은
`en.json` 과 동일하게 영어로 둔다. 번역하면 로그·문의 대응이 더 어려워진다.

---

## 2. 서버 푸시 문구 (필수)

`supabase/functions/_shared/i18n.ts`

1. `Lang` 타입과 `SUPPORTED` 배열에 코드 추가
2. `STRINGS` 에 해당 언어 블록 추가 (ko 블록의 키를 전부 채운다 — 41개)
3. 배포:
   ```
   for f in notify-family-joined notify-diary-entry send-missed-med-reminders \
            notify-measurement-completed process-notification-queue \
            send-appointment-reminders send-medication-reminders; do
     supabase functions deploy "$f" --project-ref avqaflxufyadgzjiojkk
   done
   ```
4. **배포 후 반드시 실제 호출로 부팅 확인.** 함수가 `_shared/i18n.ts` 를
   import 하는데 import 문이 빠져 있으면 배포는 성공하고 런타임에서만
   ReferenceError 가 난다 — 복약 알림이 통째로 안 나가는 사고로 이어진다.
   ```
   curl -s -X POST "$URL/functions/v1/send-medication-reminders" \
     -H "Authorization: Bearer $ANON" -d '{}'
   # → 200 {"sent":N,...} 이어야 한다. 503/500 이면 부팅 실패.
   ```

함수 코드 자체는 언어가 늘어도 수정할 필요가 없다. `resolveLang()` 이
`users.language` 를 정규화하고, 모르는 언어는 한국어가 아니라 **영어**로 떨어진다.

---

## 3. 검사 (배포 게이트)

```
node scripts/i18n-check.mjs <lang>          # 반드시 통과해야 배포
node scripts/i18n-length-audit.mjs <lang> en
```

`i18n-check` 가 잡는 것:
- 번역 누락 (키 자체가 없음 → 화면에 `medication.title` 같은 개발자 문자열 노출)
- **한글 잔존** — 해외 사용자에게 한글이 보이는 건 가장 치명적이라 실패 처리
- `{{변수}}` 불일치 (값이 안 나오거나 문장이 깨짐)

실행 중 한글 노출은 `src/i18n/hangulGuard.ts` 가 개발 빌드에서 한 번 더 잡는다
(해외 로케일인데 화면에 한글이 그려지면 `console.error`).

---

## 4. 레이아웃 검수 — 폰트는 줄이지 않는다

60대 이상 타겟이라 글자 크기(18sp+)·버튼 높이(56dp+)는 **번역 때문에 절대 줄이지
않는다**. 대신 **폭이 실제로 제한된 자리만** 골라 문구를 짧게 잡는다.

`i18n-length-audit` 은 키 이름으로 추정하는 휴리스틱이라 200건씩 나온다.
그중 진짜 깨지는 건 `numberOfLines={1}` + 고정폭인 곳뿐이다. 확인된 자리:

| 자리 | 파일 | 텍스트 가용 폭 | 비고 |
|---|---|---|---|
| 기록 기간 탭(3등분) | `RecordsScreen` / `RecordDetailScreen` | ≈78pt @16pt | `records.periodWeek/Month/3Month` |
| TopBar 타이틀 | `components/common/TopBar.tsx` | ≈206pt @20pt Bold | 좌우 고정 76pt 박스 사이 |
| TopBar 우측 액션 | 같은 파일 (`rightWide`) | 96pt @16pt | 예: `notifHistory.markAllRead` |
| 커뮤니티 서브탭(5등분) | `FeedScreen` | ≈51pt @16pt | 해외 빌드는 Feed 탭 자체가 없음 |
| 글쓰기 카테고리 칩(4등분) | `PostWriteScreen` | ≈60pt @12pt | 〃 |

문제 없는 자리(확인 완료):
- 하단 탭바 — `adjustsFontSizeToFit` + `minimumFontScale={0.8}` 이 이미 걸려 있음
- 영상 목록 필터 — 가로 ScrollView 라 넘칠 수 없음 (오너 확정 "전역 필터칩 표준")
- 알림창(dialog) 제목·본문 — 줄바꿈됨
- 진행 표시 스텝 라벨 — `flexWrap` + 내용 폭

해외 빌드에서 **Feed(정보/나눔) 탭은 마운트되지 않는다**
(`MainNavigator` 가 `OverseasMedTab` 으로 교체). 커뮤니티 문자열은 번역해 두되
레이아웃 우선순위는 낮다.

---

## 5. 남은 것 (앱 밖)

- iOS 네이티브 `locales/<lang>.json` (권한 문구 등) → **OTA 불가, 재빌드 필요**
- Play 스토어 등록정보 / App Store 등록정보 + 구독 상품 등록정보
- `parkinon-web` (개인정보처리방침·이용약관 페이지)
