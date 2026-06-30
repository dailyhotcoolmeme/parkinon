# PC에서 보기 — 6자리 코드 로그인 (스펙)

상태: **구현 진행** (2026-06-13 결정)
관련: `docs/web_plan.md`, `create-web-token`·`exchange-web-token` 엣지함수, `parkinon-web`, 앱 `RecordsScreen`/`DiaryScreen`

## 목표
PC로 링크를 옮기는 단계를 없애고, **앱에서 6자리 숫자 발급 → PC에서 parkinon.com 접속 후 입력**으로 기록을 본다.

## 결정사항 (오너 확정)
- 코드: **6자리 숫자**
- 유효시간: **5분**
- **5회 오입력 시 코드 폐기** + "코드를 다시 발급해 주세요" 안내
- 1회용(성공 교환 시 즉시 사용처리)
- "웹에서 보기"(이 기기 브라우저로 바로 열기), 일기 "추세보기"는 **그대로 유지**(URL 자동로그인). "PC로 보내기"(링크 공유)만 "PC에서 보기"(코드 표시)로 교체.

## 서버 계약(contract)
### `create-web-token` (발급)
- 입력: 앱 세션 JWT(기존과 동일).
- 동작: **활성(미사용·미만료) 코드와 중복 안 되는** 6자리 숫자 생성. `web_login_tokens`에 저장. TTL **5분**.
- 반환: `{ code: "123456", url: "https://parkinon.com/r/123456", expires_at }`
  - `code`: PC 수동 입력용. `url`: 같은 기기에서 바로 열기("웹에서 보기"/"추세보기")용 — path가 곧 code.

### `exchange-web-token` (교환) — URL 자동열기·PC 수동입력 공통
- 입력: `{ code: "123456" }` (또는 기존 `{ token }` 호환).
- 검증 순서: 존재 → 만료(5분, 410 expired) → 사용됨(410 used) → race-safe `used_at` 마킹 → magiclink로 세션 생성 → `{ access_token, refresh_token }`.
- **무차별 대입 방어**:
  - **IP당 실패 5회**(5분 윈도) 초과 시 차단(429/423) → 응답코드로 "시도 초과, 코드 재발급 필요" 구분.
  - 코드가 존재하나 잠금조건 충족 시 그 코드 폐기(used 처리).
  - 정확한 코드 1회 입력은 즉시 성공(실패 카운트는 틀린 입력에만).
- 응답 에러 구분(웹이 분기): `invalid`(없는 코드), `expired`, `used`, `locked`(시도 초과) → 웹은 각각 안내, 특히 locked/expired는 "앱에서 코드를 다시 발급해 주세요".

### DB `web_login_tokens`
- 기존: `token, user_id, expires_at, ip_address, user_agent, created_at, used_at`.
- `token` 칸에 6자리 코드 저장(문자열).
- 실패 카운트 방어용 컬럼 추가 가능(예 `fail_count int default 0`) 또는 별도 IP 카운트 테이블/메모리. 비파괴적 마이그레이션만.

## 웹(parkinon.com / parkinon-web)
- 첫 화면(Landing)에 **6자리 입력칸** + "확인" 추가. 입력 → `exchange-web-token({code})` → 세션 set → `/records`.
- 에러: invalid="번호가 올바르지 않아요", expired/locked="시간이 지났거나 시도를 초과했어요. 앱에서 번호를 다시 발급해 주세요", used="이미 사용된 번호예요".
- 기존 `/r/:token` 자동열기 라우트는 유지(웹에서 보기/추세보기). path token = 6자리 code로 동일 교환.

## 앱
- `RecordsScreen`: "PC로 보내기"(share) 버튼 → **"PC에서 보기"**. 누르면 `create-web-token` 호출 후 **6자리 코드를 크게 표시하는 안내 모달**: "PC에서 parkinon.com에 접속해 아래 번호를 입력하세요. (5분 안에)". 남은 시간/재발급 버튼 포함하면 더 좋음. 스와이프 닫기.
- "웹에서 보기"(open) 버튼은 그대로(url로 Linking.openURL).
- `DiaryScreen` "추세보기"는 그대로(url open).

## 보안 메모
6자리=100만 경우의 수지만 5분 만료 + IP 5회 제한 + 1회용이면 무차별 대입 사실상 불가.
