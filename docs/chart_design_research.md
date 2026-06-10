# 파킨온 그래프 화면 리뉴얼 — 외부 사례 조사 보고서

작성일: 2026-05-14
대상: parkinon.com 그래프 트렌드 화면 (60대+ 파킨슨 환자·보호자)
목적: 현재 Recharts 선그래프 6개 + 추세선 + Brush 구성의 시각적 복잡도를 줄이고, 5점 척도 데이터를 60대 사용자에게 직관적으로 보여줄 수 있는 디자인 패턴 확보

---

## 1. 요약 (5줄)

1. **가장 추천: "캘린더 히트맵 + 1개의 라지 스코어 카드" 조합** (Daylio Year in Pixels + Oura Today 카드의 결합). 6개 차트를 한 줄 라인으로 모두 늘어놓는 현재 방식을 폐기하고, 각 지표를 카드 한 장 = 큰 숫자 + 90일 미니 히트맵으로 압축하는 것이 60대 가독성과 트렌드 인지에 가장 효과적입니다.
2. **선그래프 대안 1순위는 캘린더 히트맵**(GitHub contribution 스타일). 5점 척도 좁은 범위에서 1점 등락이 크게 보이는 문제를 색 5단계로 자연스럽게 흡수하며, 3~6개월 누적도 한 화면에 들어옵니다.
3. **선그래프를 꼭 유지해야 한다면 "스파크라인 + 라지 숫자"** 패턴(Apple Health Trend Platter 방식). 축·격자선·Brush 모두 제거하고 작은 굵은 선만 카드 하단에 깔아 트렌드 방향만 인지하도록 합니다.
4. **컬러는 Whoop 식 3색 시맨틱**(좋음=green, 보통=amber, 나쁨=red) + 무채색 배경. ON/OFF 같은 이진 분류는 Whoop의 7일 라인 + 컬러 존 구조가 검증된 모델입니다.
5. **약효 시간대(직후/30분/2시간) × 몸상태/기분 6개 차트는 단일 패널 + 시간대 칩 토글**(Oura Today 패턴) 또는 **3행 mini 히트맵 그리드**로 축약하는 것을 권장합니다. 6개를 동시에 보여주는 것은 60대 사용자에게 인지 과부하입니다.

---

## 2. 사례 카드 (10개)

### 카드 1 — Bearable (Symptom Tracker)
- **분류**: 만성질환·증상 트래커 (90만 사용자, ADHD·파킨슨·만성통증 커뮤니티 표준)
- **핵심 디자인**: "주간 리포트 + 타임라인 + 캘린더 + 차트" 4종 뷰 전환. 한 화면에 한 종류만 보여줌. 1~5점 척도가 색 5단계 칩으로 매핑되며, 같은 날 여러 증상을 점 5개로 가로로 늘어놓아 1점 차이가 시각적으로 과장되지 않습니다.
- **출처**: https://bearable.app/symptom-tracker/ , https://bearable.app/ , Behance UI/UX 케이스 (703 appreciations)
- **파킨온 적용 포인트**: ① 5점 척도 = 5색 칩 매핑 직접 차용. ② "한 화면 한 뷰" 원칙 — 현재 6개 차트를 한 페이지에 쌓는 구조를 탭/세그먼트로 분리.

### 카드 2 — Daylio (Mood Tracker, Year in Pixels)
- **분류**: 5점 이모지 척도 무드 트래커 (사실상 5점 척도 시각화의 글로벌 표준)
- **핵심 디자인**: **Year in Pixels** — 1년 365칸 그리드, 각 칸이 그날의 5단계 이모지 색. 1점=짙은 빨강 → 5점=짙은 초록. 라인그래프는 월간 보조용으로만 사용하고 메인은 픽셀 그리드. 5점 척도는 무조건 색으로 처리하지 숫자축으로 안 보여줍니다.
- **출처**: https://daylio.net/ , https://en.wikipedia.org/wiki/Daylio , https://www.androidpolice.com/i-used-daylio-track-moods-for-month/
- **파킨온 적용 포인트**: ① 몸상태·기분 등 5점 척도 6개 모두 Year in Pixels 미니 버전(90일 = 13주×7일 가로 그리드)으로 압축. ② 선그래프는 같은 카드 하단에 작은 스파크라인으로만 보조.

### 카드 3 — StrivePD (FDA-cleared Parkinson Assistant)
- **분류**: 파킨슨 특화 (Apple Watch + DBS 연동, 의료기관 클리니션 대시보드 보유)
- **핵심 디자인**: 하루 타임라인 위에 복약·증상·운동·tremor·dyskinesia를 **수평 레인(swim lane)** 으로 쌓음. 5점 척도가 아닌 점 크기·색 농도로 강도 표현. 30일 뷰는 인사이트 카드 + 1개 라인 차트로 단순화.
- **출처**: https://www.strive.group/app , https://apps.apple.com/us/app/strivepd-parkinsons-assistant/id1275051699 , https://parkiesunite.com/2025/01/strivepd-precision-tracking-for-parkinsons/
- **파킨온 적용 포인트**: ① "약효 시간대 × 증상" 매트릭스를 하루 타임라인 수평 레인으로 재구성하면 6개 차트가 1개 뷰로 통합. ② ON/OFF는 레인 위 색 블록(녹/적)으로 표시 — 라인그래프보다 직관.

### 카드 4 — Apple Health (Trends & Trend Platter)
- **분류**: iOS 표준 헬스 대시보드
- **핵심 디자인**: **Trend Platter** — 카드마다 큰 숫자(현재값) + 작은 변화량(▲▼ %) + 그 아래 축·라벨 없는 미니 차트. 격자선·Brush 없음. 색은 카테고리당 한 가지만 사용. WWDC22 "Design an effective chart" 세션에서 "trend platter는 grid lines와 labels 모두 불필요"라고 명시.
- **출처**: https://developer.apple.com/videos/play/wwdc2022/110340/ , https://support.apple.com/guide/iphone/view-your-health-data-iphe3d379c32/ios
- **파킨온 적용 포인트**: ① 현재 차트의 축·라벨·Brush·격자선 모두 제거. ② "현재값 큰 숫자 + 90일 미니 스파크라인 + 추세 화살표" 3요소만 남김.

### 카드 5 — Oura Ring (Readiness Score, 2024 redesign)
- **분류**: 수면·회복 점수 (의료 신뢰감 톤의 미니멀 끝판왕)
- **핵심 디자인**: Today 탭은 **"하나의 큰 숫자(0~100 score)"** + 그 아래 카테고리 카드들. 각 카드를 탭하면 트렌드 뷰. 컬러는 컨디션별 시맨틱(파랑=optimal, 노랑=주의, 빨강=pay attention). "Focus on one big thing" 원칙.
- **출처**: https://ouraring.com/blog/new-app-design/ , https://swipefile.com/oura-ring-readiness-score , https://www.crausser.com/oura-redesign
- **파킨온 적용 포인트**: ① 5점 척도를 0~100으로 정규화(예: 3점→60)해서 "오늘의 컨디션 78"처럼 큰 숫자 1개로 요약. ② 6개 차트 페이지 진입 전 "오늘 한 줄 요약 카드" 추가.

### 카드 6 — Whoop (Recovery & Strain)
- **분류**: 회복·운동 부하 (3색 시맨틱 컬러의 정석)
- **핵심 디자인**: **3색 vocabulary** — green(#16EC06, 회복 67~100%), yellow(#FFDE00, 34~66%), red(#FF0026, 0~33%). 7일 라인 차트는 컬러존 배경으로 깔리고, strain은 일별 막대. "어떤 화면이든 같은 색은 같은 의미" 룰.
- **출처**: https://www.925studios.co/blog/whoop-design-breakdown , https://mobbin.com/colors/brand/whoop , https://support.whoop.com/s/article/Strain-and-Recovery-Details-Screens
- **파킨온 적용 포인트**: ① ON/OFF·좋음/나쁨 모두 3색만으로 표현(녹/황/적). ② 5점 척도를 5색이 아니라 3색 zone(1-2 적 / 3 황 / 4-5 녹)으로 묶으면 60대 인지 부담 감소.

### 카드 7 — GitHub Contribution Heatmap
- **분류**: 데이터 시각화 패턴 (캘린더 히트맵의 원조)
- **핵심 디자인**: 1년 = 52주×7일 그리드, 5단계 색농도. 0 = 흰색, 1~4 = 점점 짙은 녹색. 축·라벨 없음. 한 칸은 5×5px 정도로 작지만 전체 패턴이 한눈에 들어옴. 모바일에서는 가로 스크롤 또는 12주 단위 분할.
- **출처**: https://github.com/nikolaydubina/calendarheatmap , https://www.jqueryscript.net/blog/best-github-style-calendar-heatmap.html , https://dev.to/ajaykrupalk/github-like-contribution-heatmap-in-js-4201
- **파킨온 적용 포인트**: ① 약복용률·운동·취침·변비 같은 "했음/안 했음" 또는 빈도 데이터에 즉시 적용. ② 5점 척도 6개 항목도 같은 5색 히트맵으로 통일 → 모든 카드가 한 비주얼 언어.

### 카드 8 — Apple Activity Rings
- **분류**: 진행률·달성률 시각화 (Move/Exercise/Stand 3중 동심원)
- **핵심 디자인**: 3개 원이 겹쳐 닫히는 게이미피케이션. 각 원은 목표 대비 진행률 0~100%. 축·숫자 없이 색과 호의 길이만으로 즉시 인지. iOS HIG `HKActivityRingView` 표준.
- **출처**: https://developer.apple.com/design/human-interface-guidelines/activity-rings , https://developer.apple.com/documentation/healthkitui/hkactivityringview
- **파킨온 적용 포인트**: ① "오늘 약 복용률 + 운동 + 취침 달성률" 3개를 활동링으로 묶어 상단에 배치 → 트렌드 6개 차트 진입 전 도파민 트리거. ② 30일 평균 달성률 도넛으로도 응용 가능.

### 카드 9 — Parkinson's VA Motor Diary (paper standard)
- **분류**: 임상 표준 종이 다이어리 (의사들이 보는 실제 포맷)
- **핵심 디자인**: 하루를 30분 단위로 자른 가로 타임라인 + 각 슬롯에 ON/OFF/dyskinesia/asleep을 색 블록으로 칠함. 라인그래프 없음. 색 블록의 패턴 자체가 "약효 변동" 그래프.
- **출처**: https://www.parkinsons.va.gov/resources/motordiary.pdf , https://www.parkinson.org/sites/default/files/documents/parkinsons_symptoms_diary.pdf
- **파킨온 적용 포인트**: ① "약효 시간대 × 증상"을 라인그래프가 아니라 **30분 슬롯 가로 색띠**로 보여주면 의사에게 보여줄 때도 즉시 통용. ② 의학적 신뢰도까지 동시에 확보.

### 카드 10 — Bearable Behance Case + 시니어 헬스 UX 가이드라인
- **분류**: 60대+ 사용자 헬스앱 UX 원칙
- **핵심 디자인**: 본문 16px 이상 권장(굵으면 더 좋음), 고대비(검정 텍스트/흰 배경), 색만으로 정보 전달 금지 — 반드시 텍스트 라벨·아이콘 병기("Needs attention" + ⚠ ). Sans-serif (Pretendard/Apple SD Gothic 권장), 카드 간 여백 넉넉히, 그리드 정렬.
- **출처**: https://orangesoft.co/blog/guide-to-designing-healthcare-apps-for-seniors , https://www.toptal.com/designers/ui/ui-design-for-older-adults , https://pmc.ncbi.nlm.nih.gov/articles/PMC12350549/
- **파킨온 적용 포인트**: ① 모든 히트맵 셀에 hover/tap 시 "5월 3일 — 좋음(4점)" 텍스트 라벨 표시. ② 색은 항상 텍스트와 함께. ③ 본문 17~18px, 큰 숫자 카드는 32~40px.

---

## 3. 5점 척도 시각화 권장 패턴 3가지

### 패턴 A. 캘린더 히트맵 (최우선 추천)
- 90일 = 13주 × 7일 그리드, 한 칸 18~22px (60대 가독성).
- 5색 매핑: 1=짙은 적 #D64545, 2=연한 적 #F4A8A8, 3=회색 #CFD4D9, 4=연한 녹 #A8D8B9, 5=짙은 녹 #2E8B57.
- 미기록 = 흰색 + 옅은 점선 테두리.
- **장점**: 1점 등락이 색 변화로 흡수돼 시각적 진폭 과장 없음. 3~6개월 한 화면.
- **참고**: Daylio Year in Pixels, GitHub heatmap, Bearable calendar 뷰.

### 패턴 B. 큰 숫자 + 미니 스파크라인 (Trend Platter)
- 카드 상단: 30일 평균을 0~100 정규화한 큰 숫자(예: "78"), 폰트 36~40px bold.
- 그 아래: 7~14일 변화 ▲ +5 또는 ▼ −3 (녹/적).
- 카드 하단: 축·라벨·격자 없는 미니 라인 60×24px, 컬러 단색.
- **장점**: 한 줄로 "지금 상태 + 추세"가 끝남. 시니어가 숫자 하나만 봐도 됨.
- **참고**: Apple Health Trend Platter, Oura Today 카드.

### 패턴 C. 3색 Zone 띠 차트 (Likert를 3구간으로 묶기)
- 5점 척도를 3구간(1-2 나쁨, 3 보통, 4-5 좋음)으로 재매핑.
- 가로 시간축 위에 일자별 점을 찍되 배경은 3색 zone(연한 적/황/녹) 가로 띠.
- **장점**: "어제 빨강 → 오늘 초록" 식의 의미있는 변화만 인지. 미세한 1점 진동 노이즈 제거.
- **참고**: Whoop Recovery zone chart, Oura readiness band.

---

## 4. 레이아웃 권장안 (wireframe 텍스트)

```
┌─────────────────────────────────────────┐
│  ◀ 트렌드                       [주/월/3개월] │  ← 상단 기간 세그먼트만
├─────────────────────────────────────────┤
│                                         │
│   ┌─────────────────────────────────┐   │
│   │  오늘의 컨디션                    │   │  ← 단 하나의 라지 스코어 카드
│   │                                 │   │     (Oura Today 패턴)
│   │        78                       │   │     32~40px 숫자
│   │      ▲ +4  지난주 대비            │   │
│   │  ▁▂▃▄▅▆▇▆▅▄▃▄▅▆▇ (스파크라인)     │   │
│   └─────────────────────────────────┘   │
│                                         │
│   ┌─ 약효 시간대 ─────────────────────┐   │
│   │  [직후] [30분] [2시간]   ← 칩 토글  │   │  ← 6개 차트 → 1개 패널 + 토글
│   │                                 │   │
│   │  몸상태  ■■▢▢■■■■▢■■■■▢ ... (히트맵) │   │  ← 90일 미니 캘린더 히트맵
│   │  기분    ■▢■■■■▢■■▢■■■■■ ...      │   │
│   └─────────────────────────────────┘   │
│                                         │
│   ┌─ 일상 습관 ──────────────────────┐   │
│   │  💊 약 복용률      92% ●●●●●○      │   │  ← 카드 한 장 = 라벨 + 숫자
│   │  🚶 운동           4/7일 ●●●●○○○   │   │     + 5점 도트
│   │  🌙 취침           평균 6.4시간    │   │
│   │  💩 변비           편안 5일        │   │
│   └─────────────────────────────────┘   │
│                                         │
│   [📋 의사에게 보내기 PDF 내보내기]        │   ← 액션은 명시적 텍스트 버튼
└─────────────────────────────────────────┘
```

핵심 원칙:
- **한 화면 = 카드 3~4장 최대**, 세로 스크롤로 자연스럽게 추가
- **현재의 Recharts Brush·추세선·축 라벨 전부 제거**
- 시간대(직후/30분/2시간) × 항목(몸상태/기분) = 6개 → **시간대 칩 토글로 차트는 2개**, 또는 3행 미니 히트맵 그리드로 압축
- 모든 셀에 탭 시 툴팁: "2026-05-12 화 · 몸상태 좋음(4점)"

---

## 5. 컬러 팔레트 후보

### 팔레트 A — "Clinical Calm" (의료 신뢰감, 메인 추천)
- 배경: `#F7F9FB` (off-white)
- 카드: `#FFFFFF`
- 본문 텍스트: `#1F2937` (slate-800)
- 보조 텍스트: `#6B7280`
- Primary 액션: `#2C7BE5` (medical blue)
- 5단계 히트맵: `#D64545` → `#F4A8A8` → `#E5E7EB` → `#A8D8B9` → `#2E8B57`
- 출처 영감: Apple Health, MyChart, [Trustworthy Teals 팔레트](https://www.media.io/color-palette/medical-color-palette.html)

### 팔레트 B — "Whoop Semantic 3-Tone" (이진·구간 분류용)
- 좋음/회복: `#16C172`
- 보통/주의: `#F4B740`
- 나쁨/OFF: `#E5484D`
- 배경/중성: `#F4F4F5`, 텍스트 `#111827`
- 출처: [Whoop Brand Color](https://mobbin.com/colors/brand/whoop) (#16EC06 → 채도 낮춰 의료톤화)

### 팔레트 C — "Parkinon Warm Trust" (현재 앱 오렌지 정체성 유지)
- 배경: `#FFF9F3`
- Primary: `#F18A2C` (현재 파킨온 오렌지)
- 5단계 히트맵: `#C0392B` → `#E89B7C` → `#ECECEC` → `#9DC9A8` → `#2D7A4F`
- 본문: `#2B2118`
- **주의**: 60대 환자에게 오렌지는 강조에만, 데이터 표현은 의료 세만틱(녹/적) 유지

---

## 6. 즉시 적용할 변경점 (우선순위 5개)

1. **Recharts Brush와 축 라벨·격자선 제거** — 현재 화면 복잡도의 절반은 차트 UI 자체. 한 차트당 시각 요소를 (선, 점, 라벨 1개)로 줄이면 즉시 가벼워집니다.
2. **5점 척도 6개 차트 → 캘린더 히트맵 카드 6개로 교체** — 동일 시각 언어로 통일. 1점 진폭 노이즈 해소. 3~6개월 누적도 한 화면.
3. **상단에 "오늘의 컨디션" 라지 스코어 카드 1개 추가** (Oura Today 패턴) — 들어가자마자 큰 숫자 하나로 요약. 60대 사용자가 차트를 다 안 봐도 됨.
4. **약효 시간대(직후/30분/2시간) 3개 차트를 칩 토글 1개 패널로 통합** — 화면 차트 수 6→2. 또는 VA Motor Diary식 30분 슬롯 가로 색띠로 대체.
5. **컬러를 의료 세만틱 3색(녹/황/적) + 무채색 배경으로 통일** + 본문 17~18px, 큰 숫자 36~40px, 모든 색 표시에 텍스트 라벨 병기 — 시니어 헬스 UX 가이드라인 준수.

---

## 출처 모음

- Bearable: https://bearable.app/symptom-tracker/
- Daylio Year in Pixels: https://daylio.net/ , https://en.wikipedia.org/wiki/Daylio
- StrivePD: https://www.strive.group/app , https://parkiesunite.com/2025/01/strivepd-precision-tracking-for-parkinsons/
- Apple Health WWDC22 "Design an effective chart": https://developer.apple.com/videos/play/wwdc2022/110340/
- Apple Activity Rings HIG: https://developer.apple.com/design/human-interface-guidelines/activity-rings
- Oura new design: https://ouraring.com/blog/new-app-design/ , https://swipefile.com/oura-ring-readiness-score
- Whoop design breakdown: https://www.925studios.co/blog/whoop-design-breakdown , https://mobbin.com/colors/brand/whoop
- GitHub heatmap libs: https://github.com/nikolaydubina/calendarheatmap , https://www.jqueryscript.net/blog/best-github-style-calendar-heatmap.html
- VA Parkinson Motor Diary: https://www.parkinsons.va.gov/resources/motordiary.pdf
- Parkinson Foundation Symptoms Diary: https://www.parkinson.org/sites/default/files/documents/parkinsons_symptoms_diary.pdf
- Likert 시각화: https://nightingaledvs.com/visualizing-likert-scale-data-same-data-displayed-seven-different-ways/ , https://chartengine.io/5-point-likert-scale-analysis-use-cases/
- 시니어 헬스 UX: https://orangesoft.co/blog/guide-to-designing-healthcare-apps-for-seniors , https://www.toptal.com/designers/ui/ui-design-for-older-adults , https://pmc.ncbi.nlm.nih.gov/articles/PMC12350549/
- 의료 컬러: https://www.media.io/color-palette/medical-color-palette.html , https://piktochart.com/blog/medical-color-palette/
