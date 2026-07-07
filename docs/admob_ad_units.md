# AdMob 앱 ID · 광고단위 ID (확정본)

오너가 2026-07-07 발급·전달. **확정본 — 다시 묻지 말 것.** 코드에서 바로 쓰는 상수는
[`src/constants/adUnitIds.ts`](../src/constants/adUnitIds.ts) 에 있음(이 문서는 원장/근거).

- Publisher ID: `pub-2792582436871752` (공통)
- 포맷: 전부 **네이티브(Native advanced)**. 전면/앱오픈 없음.
- 웹 배너(parkinon-web)는 AdMob 아님 → **AdSense 별도** (여기 없음).
- 개발 빌드에서는 실 ID 금지 → 구글 테스트 ID 사용(자기 광고 클릭=계정 정지).

## 앱 ID (App ID, `~` 구분자 — app.json GADApplicationIdentifier)

| 플랫폼 | 앱 ID |
|---|---|
| Android | `ca-app-pub-2792582436871752~4028284031` |
| iOS | `ca-app-pub-2792582436871752~9641708372` |

## 네이티브 광고단위 ID (`/` 구분자)

| 배치 (placement 키) | 위치 | Android | iOS |
|---|---|---|---|
| `medication` | 약복용 탭 첫 슬롯 | `…/7236825329` | `…/7290877209` |
| `bodyState` | 몸상태 탭 첫 슬롯 | `…/3846456213` | `…/3351632197` |
| `exercise` | 운동 탭 첫 슬롯 | `…/9671416975` | `…/2838415312` |
| `remindersMeds` | Reminders→약관리, 처방전 버튼 아래 | `…/8068736862` | `…/1525333648` |
| `remindersDoseTimes` | Reminders→복용시간, 슬롯 1·2 사이 | `…/4021680648` | `…/5251001833` |
| `more` | More 메뉴, 섹션 1·2 사이 | `…/3106008627` | `…/9288273594` |

(전체 값은 `…` 축약 없이 `src/constants/adUnitIds.ts` 참조)

## 반영 시점

Phase 6(광고 SDK 통합, 재빌드 1회)에서:
- `app.json` GADApplicationIdentifier(Android/iOS) ← 위 앱 ID
- 네이티브 광고 렌더 6곳 ← `getAdUnitId(placement)` 사용
- 자세한 통합 절차는 [monetization_plan.md](./monetization_plan.md) Phase 6 참조.
