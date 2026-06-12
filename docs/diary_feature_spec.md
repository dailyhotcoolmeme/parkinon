# 종합 데일리 저널 (하루 기록 일기) — 설계 문서

> 작성: 2026-06-12. 파킨온에 "하루하루 종합 일기" 기능 추가. 기존 기록(약·약효·운동·미디어)을 자동으로 한 장에 모으고, 환자·보호자가 글/음성/사진/영상으로 한마디를 덧붙이는 형태.

## 1. 컨셉
- 그날 자동으로 쌓인 기록을 **날짜별 한 장**으로 종합 + 사람이 **한마디**를 더한다.
- **자동 수집이 메인, 한마디는 보너스** — 빈 일기장을 주면 안 쓰므로 부담 최소화.
- 환자·보호자가 **같이** 채운다(공동 작성).

## 2. 위치 (결정됨)
- **진입 버튼 = 톱바(TopBar)** — 알림 종(🔔) 옆에 일기 아이콘(📔). 모든 메인 화면에서 1탭으로 "오늘 일기".
- **열람·저장 = 기록·관리 탭 > 기록** — 일자별로 과거 일기 확인(달력/이전·다음 날짜).

## 3. 한 장의 구성
### 3-1. 자동 수집 영역 (기존 데이터 재활용, 쓰기 없음)
- 💊 약 복용: `med_logs` (그날 슬롯별 복용 시각)
- 😊 약효추적: `on_off_logs` (시점별 몸상태·기분 점수)
- 🏃 운동: `exercise_logs`
- 📷 사진·영상: `media_logs` (그날 몸상태 촬영)
- → `HistoryTimeline` 컴포넌트가 이미 날짜별로 묶어 보여주므로 그대로 재활용.

### 3-2. 사람 작성 영역 ("한마디", 신규 데이터)
- **글** — 텍스트. **즉시 받아쓰기는 키보드 마이크(폰 내장 STT)** 로 입력(코드 0, OTA 가능, 새 빌드 불필요).
- **음성 첨부** — 오디오 파일로 저장·재생. **STT 안 함**(목소리 그대로). 알림음 직접녹음 인프라(R2 오디오 업로드) 재활용.
- **사진** — R2 업로드(기존 미디어 업로드 재활용).
- **영상** — R2 업로드. **길이·용량은 "영상 기록"과 동일 기준**(최대 2분·압축). 기존 녹화/업로드 인프라 재활용.
  - 일기 첨부 영상은 **`media_logs`에도 자동 저장**(출처='diary'). → 일기·영상 기록 양쪽에서 보임.
  - **영상 기록 보기 페이지**: "**일기 기록 영상 제외**" 체크박스 → 체크 시 출처='diary' 숨겨 **수동 저장분만** 표시.
  - **영상 기록 리스트의 일기 출처 항목**: "**일기 보기**" 버튼 → 그 영상의 날짜 일기로 바로 이동.
- **사진** — 일기에만 저장(별도 사진 목록 없음). (영상만 영상 기록과 연동)
- **공동 작성** — 한 날짜에 **환자 칸 / 보호자 칸** 각각, "누가 썼는지" 이름 표시.

### 3-3. 웹 추세 보기 (재활용)
- 일기 보다가 "요즘 추세?" 싶을 때 → **웹 차트 뷰어로 점프**.
- 기존 `RecordsScreen.handleWebOpen`과 동일: `create-web-token` Edge Function 호출 → `{ url }`(parkinon.com/r/<token>, 30분 유효) → `Linking.openURL`. (웹쪽 `/r/:token` TokenExchange → `exchange-web-token` → 세션 → /records 까지 이미 구축됨.)
- 일기 화면에 "📊 웹으로 추세 보기" 버튼 하나만 추가.

## 4. 공유 범위 (결정됨)
- 연동 **그룹 안에서 서로 열람** — 환자 음성·사진·영상 ↔ 보호자 메모를 같은 그룹이 함께 봄.
- DB 레벨 RLS: `is_same_patient_group` 기반(기존 패턴).

## 5. 열람 화면 레이아웃 (결정됨)
```
┌─ 일기  [◀ 6/12 (목) ▶]   📅 ─┐   ← 이전/다음 날짜 + 달력
│  ─ 오늘의 기록(자동) ─        │
│  💊 아침6:00·점심12:00 복용    │
│  😊 약효추적 3건 (복용직후 4점)│
│  🏃 걷기 30분                  │
│  📷 [사진][영상] 썸네일        │
│  ─ 한마디 ─                   │
│  ┌ 👤 최성철(환자) ──────┐    │
│  │ "오늘 컨디션 좋았어요" │    │
│  │ 🎙 음성▶ 📷사진 🎬영상 │    │
│  └───────────────────────┘    │
│  ┌ 🧑 보호자 ○○ ─────────┐    │
│  │ "아침 약 잘 챙기심"    │    │
│  └───────────────────────┘    │
│  [ ✏️ 오늘 일기 쓰기 ]  [ 📊 웹으로 추세 보기 ] │
└───────────────────────────────┘
```

## 6. 데이터 모델 (신규)
신규 테이블 `diary_entries` — 사람이 쓴 "한마디"만 저장(자동 영역은 기존 테이블에서 조회).
- `id uuid pk`
- `patient_id uuid` — 이 일기가 속한 환자(=날짜의 주인)
- `author_id uuid` — 작성자(환자 본인 또는 같은 그룹 보호자)
- `entry_date date` — 일기 날짜(KST 기준)
- `text text` — 글(받아쓰기 포함)
- `audio_url text` — 음성 첨부(R2). STT 안 함.
- `photo_urls text[]` — 사진(R2). 일기 전용(영상 기록과 연동 안 함).
- `video_media_id uuid` — 영상은 `media_logs`에 저장하고 그 행을 참조(중복 저장 방지).
- `created_at / updated_at timestamptz`
- 유니크: `(patient_id, entry_date, author_id)` — 작성자별·날짜별 1장.
- **RLS**: select/insert/update/delete 모두 `is_same_patient_group(patient_id)` + insert 시 `author_id = auth.uid()`.

### 6-1. `media_logs` 확장 (영상 ↔ 영상 기록 연동)
- `source text default 'manual'` 컬럼 추가 — 일기에서 첨부한 영상은 `'diary'`.
- 일기 영상 업로드 = `media_logs` 행 1개 생성(`source='diary'`, patient_id, 날짜) + `diary_entries.video_media_id`로 참조.
- **영상 기록 보기(VideoListScreen)**:
  - "일기 기록 영상 제외" 체크박스 → 체크 시 `source='diary'` 행 숨김.
  - `source='diary'` 항목엔 "일기 보기" 버튼 → 해당 행의 날짜로 일기 화면 이동.

## 7. 재활용 자산
- `HistoryTimeline` (날짜별 자동 종합) · `media_logs`+R2 업로드 · 알림음 녹음(R2 오디오) · `create-web-token`/`exchange-web-token`(웹 추세) · `is_same_patient_group` RLS.

## 8. MVP 구현 순서(안)
1. DB: `diary_entries` 테이블 + RLS, `media_logs.source` 컬럼 추가 마이그레이션
2. 톱바에 일기 아이콘(📔) 추가 → "오늘 일기" 진입
3. 일기 열람 화면(기록·관리 > 기록): 날짜 네비 + 자동 영역(HistoryTimeline 재활용) + 한마디 카드(환자/보호자)
4. 일기 작성: 글(키보드 받아쓰기)·음성 첨부·사진·영상(영상기록 기준) — 기존 업로드 재활용
5. 영상 기록 연동: 일기 영상 `media_logs(source='diary')` 저장 + VideoList "일기 영상 제외" 체크박스 + "일기 보기" 버튼
6. "📊 웹으로 추세 보기" 버튼(create-web-token 재활용)
7. 공동작성 표시(작성자 이름) + 그룹 공유 확인

## 9. 비고
- 전부 OTA 가능(네이티브 모듈 추가 없음). STT는 키보드 받아쓰기라 새 빌드 불필요.
- "🎤 말로 쓰기" 전용 실시간 STT 버튼은 네이티브 모듈→새 빌드 필요하므로 MVP 제외(추후 옵션).

---

# 10. 비주얼 디자인 v2 — 일기장 미감 (2026-06-12 재설계)

> 1차 구현이 임상적·정신없음. 재설계 방향: **사람의 한마디가 주연, 자동 데이터는 조용한 배경.** 크림 종이 + 잉크 + 테라코타. 녹색 0%(이 화면 한정). 추후 ebook·수익화 대상이라 따뜻하고 간직하고 싶은 페이지여야 함. (디자인·심리 두 에이전트 합의 결과)

## 10-1. 로컬 팔레트 `Journal` (DiaryScreen 전용, 전역 Colors 미변경)
| 토큰 | HEX | 용도 |
|---|---|---|
| page | #F7F1E3 | 화면 배경(크림 종이) |
| pageDeep | #F1E8D3 | 작성 모달 배경 |
| card | #FFFDF7 | 한마디 카드 표면 |
| rule | #E3D7BC | 괘선·구분선·날짜 밑줄 |
| cardBorder | #EADFC6 | 카드 테두리 1px |
| ink | #33291E | 본문 잉크(따뜻한 진갈색, 순흑 금지) |
| inkSoft | #6B5D4A | 보조 텍스트 |
| inkFaint | #9A8B73 | 자동 기록 본문 |
| placeholder | #B6A68A | 에디터 플레이스홀더 |
| accent | #C2613D | 테라코타(저자명·추세보기·저장·액티브) |
| accentSoft | #F0E0D2 | 악센트 배경칩 |
| mine | #A8843C | 내 카드 좌측 북마크 바(머스터드) |
| videoScrim | rgba(38,28,18,0.45) | 영상 썸네일 위 |
순백·순흑·녹색 금지.

## 10-2. 타이포 (시스템 폰트만; serif=Platform.select({ios:'Georgia',android:'serif'}))
- 날짜 숫자 28/700 serif ink · 요일 18/500 serif inkSoft
- **한마디 본문(HERO) 22/400 serif ink, lineHeight 36** ← 화면 최대 글자
- 저자명 18/600 serif accent · 역할 13/600 sans inkSoft
- 자동 기록 행 16/500 sans inkFaint · 약효 점수칩 15/600
- 섹션 라벨 14/700 sans inkSoft letterSpacing 2.0
- 에디터 플레이스홀더 20/400 serif placeholder
- 13px 미만 금지, 터치타깃 48~56 유지. 대비는 ink on card(~10:1).

## 10-3. 레이아웃·위계 (정신없음 해소)
1. **날짜 헤더**: 종이 톤(흰 바 제거), 날짜 아래 폭60% rule 1px 밑줄, "6 / 12" + "목요일", 오늘이면 accentSoft 칩, 좌우 화살표(48 터치).
2. **한마디(HERO)를 위로**, 자동 기록은 아래 푸터로. (사람 글이 주연)
3. **오늘의 기록(자동) = 조용한 푸터 스트립**: page와 거의 같은 톤, 상단 rule 1px, 그림자 없음.
   - 헤더: 좌 "오늘의 기록"(라벨) / **우측 끝 "추세보기" pill**(accent 글자+accentSoft 배경, chevron, 텍스트 동반).
   - 행: 💊약 복용 N회·시각 / 😊약효추적 **모든 점수 가로칩**(`[복용직후 4][30분 3][2시간 4]`, on_off_logs.trigger_time_label+body_state, 가로스크롤 scrollbar 숨김) / 🏃운동.
   - **사진·영상 행 삭제**(한마디 첨부와 중복).
4. **한마디 EntryCard**: card 배경 radius14 padding20, 내 카드=좌측 4px mine 북마크 바(테두리로 가두지 않음), 헤더(👤저자명 accent + 역할), 본문 22 serif, 첨부(사진 폴라로이드 프레임→ImageGalleryViewer / 영상 썸네일+play→풀스크린 / 음성 인라인 pill accentSoft).
5. **작성 에디터=펼친 일기장**(폼 아님): pageDeep 배경, 무테 텍스트영역(card, 괘선 느낌, 20 serif), 플레이스홀더 "오늘 하루는 어떠셨나요?", 조용한 첨부 칩 한 줄([🎙음성][📷사진][🎬영상]), **저장 버튼 테라코타**(녹색 아님).

## 10-4. 미디어 뷰잉
- 사진 → 기존 `src/components/common/ImageGalleryViewer.tsx` 라이트박스 재사용(전체화면·스와이프·탭 닫기).
- 영상 → 풀스크린 재생. **expo-video 대신 현재 빌드에 있는 expo-av Video 사용**(VideoRecord/List가 씀, OTA 크래시 방지). 검정 Modal + contentFit contain + 컨트롤 + "닫기"(아이콘+텍스트).

## 10-5. useDiary 보강
- on_off_logs select에 `trigger_time_label` 추가 → `AutoSummary.onOff.scores: { label, score }[]`(시각별 전체) 노출. representativeScore 단일은 폐기/대체.
