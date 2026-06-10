# parkinon.com 웹 기록 보기 — 설계 문서

## 목표
- 도메인: parkinon.com (Cloudflare 등록)
- 앱에서 "웹에서 보기" 버튼 → 사용자/보호자가 PC·모바일 웹으로 기록 상세 조회
- 1·2단계 동시 구현

## 범위
### 1단계 — 환자 본인 기록 보기
- 약복용 / 몸상태 / 운동 / 약효 트렌드
- 앱의 "기록 보기" 화면을 반응형 웹으로 이식

### 2단계 — 보호자 열람 + PDF 내보내기
- 연동된 환자의 기록 열람 (RLS로 권한 제어)
- 화면 내 "PDF로 저장" 버튼 → 클라이언트 사이드 생성 (`jsPDF` or `react-pdf`)

### 권한
- **읽기 전용** (수정/삭제 금지)

## 아키텍처

```
┌─────────┐    매직토큰 발급    ┌──────────────────────┐
│  App    │ ─────────────────▶ │ Supabase Edge Func   │
│         │                    │ create-web-token     │
└─────────┘                    └──────────────────────┘
     │                                    │
     │ https://parkinon.com/r/{token}     │ token → DB 저장
     ▼                                    ▼
┌─────────────────┐  토큰 교환  ┌──────────────────────┐
│ CF Pages (SPA)  │ ──────────▶ │ Supabase Edge Func   │
│ parkinon.com    │             │ exchange-web-token   │
└─────────────────┘             └──────────────────────┘
     │ Supabase session                   │
     │                                    ▼
     ▼                          Supabase Auth session 반환
┌─────────────────┐
│  RLS 통한       │
│  records 조회   │
└─────────────────┘
```

### 기술 스택
- 프론트: Vite + React + TypeScript (CF Pages 배포)
- 라우팅: React Router
- 차트: Recharts (앱과 동일)
- PDF: jsPDF + html2canvas (클라이언트 사이드, 비용 0)
- 인증: Supabase Auth (앱과 동일 프로젝트)
- 호스팅: Cloudflare Pages (parkinon.com 루트)

### 비용 예상
- CF Pages: 무료 (대역폭/빌드 충분)
- Supabase Edge Function: 무료 500K/월
- CF Workers: 안 씀 (PDF 클라이언트 생성)
- **예상 월 비용: 0원** (사용자 1만 명까지)

## 매직토큰 흐름

### 발급 (앱)
1. 사용자가 앱에서 "웹에서 보기" 탭
2. 앱: `create-web-token` Edge Function 호출 (현재 세션 JWT로 인증)
3. Edge Function:
   - `web_login_tokens` 테이블에 row 삽입
     - `token`: 32바이트 랜덤 hex
     - `user_id`: 현재 사용자
     - `expires_at`: now() + 30분
     - `used_at`: null
   - 반환: `{ url: "https://parkinon.com/r/{token}" }`
4. 앱:
   - 모바일: in-app browser로 즉시 오픈
   - "PC로 보내기": 같은 URL을 카카오톡 나에게 보내기 / 이메일 / 클립보드 복사

### 교환 (웹)
1. 사용자가 `parkinon.com/r/{token}` 접속
2. 웹: `exchange-web-token` Edge Function 호출
3. Edge Function:
   - 토큰 조회 → 만료/사용여부 검증
   - `used_at = now()` 표시 (재사용 차단)
   - **Supabase Admin SDK로** 해당 user_id의 임시 세션 생성 (`auth.admin.createUser` 아닌 `generateLink` 활용)
   - 반환: `{ access_token, refresh_token }`
4. 웹: `supabase.auth.setSession()` → 로그인 완료 → 기록 화면

### 세션 정책
- access_token: 1시간 (Supabase 기본)
- refresh_token: 24시간 sliding (활동 중이면 자동 갱신)
- 24시간 미사용 시 자동 로그아웃 → "앱에서 다시 열기" 안내

## DB

### web_login_tokens (신규)
```sql
create table web_login_tokens (
  token        text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now(),
  ip_address   inet,
  user_agent   text
);

create index on web_login_tokens (user_id, created_at desc);
-- 만료 토큰 자동 정리: 7일 지난 row 삭제 cron
```

### RLS (기존 테이블 활용)
- `med_logs`, `on_off_logs`, `exercise_logs`, `symptom_notes`, `media_logs`
- 정책: `user_id = auth.uid()` 또는 `user_id IN (보호자 연동된 환자 ID들)`
- 이미 앱에서 쓰는 RLS 그대로 → 웹에서도 동일하게 작동

## 라우트

```
/                          (랜딩 — "앱에서 발급된 링크로 들어오세요")
/r/{token}                 매직토큰 교환 → /records로 리다이렉트
/records                   본인 기록 메인 (탭: 약복용/몸상태/운동/약효)
/records/medication        약복용 상세 트렌드
/records/symptom           몸상태 상세
/records/exercise          운동 상세
/records/on-off            약효 트렌드
/records/family/{user_id}  보호자 → 환자 기록 (RLS로 권한 검증)
/records/export            PDF 다운로드 화면 (기간 선택 → 생성)
/logout
```

## 차트 (핵심)

### 형태
- **선그래프 (LineChart)** — 일자별 점을 선으로 연결
- 기록 없는 날은 점/선 끊김 (`connectNulls={false}`)
- 누적 무제한 → 3~6개월 진료 주기 동안 트렌드 비교 가능

### 인터랙션
- **가로 스크롤** (모바일·PC 공통) — 긴 트렌드에서 좌우 스와이프·드래그
- 하단 미니맵 (`Brush`) — 전체 기간 중 보고 있는 구간 표시 + 드래그로 범위 변경
- 더블탭/더블클릭 → 전체 fit
- 핀치 줌 (모바일), 휠 줌 (PC)

### x축 동기화
- 약복용 / 몸상태 / 운동 / 약효 — **모든 차트 같은 날짜축**
- 같은 `domain`, 같은 `ticks`, 같은 `Brush` 상태 공유
- 한 차트에서 스크롤·줌 → 나머지 차트 함께 이동
- 위아래로 비교: "이날 약 안 먹어서 몸상태 떨어졌네"

### 약 변경 마커 (약복용 차트 전용)
- `ReferenceLine` 수직 점선 + 상단 라벨
- 예: `5/12 ▼ 시네메트 추가`, `5/20 ▲ 마도파 중단`
- 데이터 소스: `medications.created_at` (시작) + `medications.ended_at` (종료, **신규 컬럼 필요**)

### 시리즈별 y축
- 약복용: 0~100% (일별 복용률)
- 몸상태: 1~5점 (복용직후/30분/2시간 별 3개 라인)
- 약효: on/off 비율 (0~100%)
- 운동: 분 (0~120+)

### 라이브러리
- **Recharts** + `recharts-zoom` 또는 자체 `Brush`
- 대안: `visx`, `Apache ECharts` (긴 시계열 성능 더 좋음, 약 1년 누적되면 고려)

## DB 변경

### medications 테이블 — `ended_at` 추가
```sql
alter table medications
  add column ended_at timestamptz;

-- is_active=false 인 기존 행은 backfill 필요 (created_at + 30일 등 합리적 값)
-- 또는 NULL 두고 차트에서 "종료일 미상" 처리
```

### 트리거 (선택)
```sql
-- is_active를 false로 바꾸면 ended_at 자동 기록
create or replace function set_ended_at_on_deactivate()
returns trigger as $$
begin
  if old.is_active = true and new.is_active = false and new.ended_at is null then
    new.ended_at := now();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_medications_ended_at
before update on medications
for each row execute function set_ended_at_on_deactivate();
```

## PDF 출력

- 화면에서 보는 선그래프 그대로 PDF에 출력
- A4 **가로 방향** (긴 트렌드 잘 보이게)
- 페이지 분할:
  1. 표지 (사용자명 / 기간 / 생성일)
  2. 약복용 + 약 변경 마커 (전체 폭)
  3. 몸상태/기분 트렌드 (3개 라인)
  4. 약효 패턴
  5. 운동
- 모든 차트 동일 x축 → 진료 시 종이로 위아래 비교 가능
- 기간이 매우 길면 (>6개월) 페이지마다 1~2개월씩 분할 출력 옵션

## 반응형 레이아웃

### 모바일 (<768px)
- 앱 "기록 보기" 와 동일한 카드 스택
- 글씨 18px↑, 버튼 56px↑
- 상단 탭바, 하단 여백

### PC (≥768px)
- 좌측 사이드바 (탭 메뉴)
- 메인 영역에 차트 + 카드 grid (2~3열)
- PDF 내보내기 우상단 고정 버튼

### 공통
- 색상: 앱 #4CAF50 그대로
- 폰트: Pretendard or system-ui
- 다크모드: 1차에서는 라이트만

## PDF 내보내기 (클라이언트)

- 기간 선택: 1주 / 1개월 / 3개월 / 직접 선택
- 페이지 구성:
  1. 표지: 사용자명·기간·생성일
  2. 약복용 요약 + 캘린더
  3. 몸상태/기분 트렌드 차트
  4. 약효(on-off) 패턴
  5. 운동 기록
- 라이브러리: `jspdf` + `html2canvas` (각 섹션 캡처 → A4 페이지로 합성)
- 모바일에서도 동작 (다운로드 → 파일 앱)

## 배포 파이프라인

```
parkinon-web (별도 레포 또는 모노레포 폴더)
 ├─ src/
 ├─ vite.config.ts
 ├─ wrangler.toml (optional)
 └─ .github/workflows/deploy.yml
```

- GitHub push → CF Pages 자동 빌드·배포
- `parkinon.com` → CF Pages 프로젝트 연결 (DNS는 CF 내 자동)
- 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (CF Pages 설정에서)

## 보안 체크리스트
- [x] 토큰 1회용 (used_at 검증)
- [x] 토큰 30분 만료
- [x] HTTPS 강제 (CF 기본)
- [x] RLS로 본인/연동가족 외 접근 차단
- [x] 토큰 발급 rate limit (분당 5회) — Edge Function 내 구현
- [x] 만료 토큰 자동 정리 (pg_cron 매일)
- [x] 보호자 권한 변경 즉시 반영 (RLS는 매 쿼리 평가)

## 구현 순서
1. **DB**: web_login_tokens 테이블 + RLS 정책 점검
2. **Edge Functions**: create-web-token, exchange-web-token
3. **웹 프로젝트 부트스트랩**: Vite + React + Supabase JS, /r/{token} 라우트 + 기록 화면 1개
4. **CF Pages 배포 + parkinon.com 연결**
5. **앱**: "웹에서 보기" / "PC로 보내기" 버튼 추가 (기록 화면)
6. **나머지 화면**: 약복용/몸상태/운동/약효 트렌드, 가족 열람
7. **PDF 내보내기**
8. **사용성 테스트** (60대 보호자 1명, 환자 1명 가상 시나리오)

## 미정 / 추후 결정
- [ ] 도메인 이메일 (admin@parkinon.com 등)
- [ ] 약관·개인정보처리방침 웹 페이지 (앱과 동일 문서 호스팅)
- [ ] SEO/오픈그래프 (랜딩만 필요)
- [ ] 다국어 (1차: 한국어만)
