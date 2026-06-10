# 파킨슨 디지털 바이오마커 심층 리서치 (파킨온 의사결정용)

**작성일**: 2026-05-24
**목적**: 파킨온에 스마트폰 기반 PD 자가측정(디지털 바이오마커) 도입 검토를 위한 학술·임상·규제 종합 정리
**원칙**: 1차 출처(논문 DOI/가이드라인 URL) 인용. **[확정]** = 인용 근거, **[추정]** = 논리적 추론

---

## A. 학회·진료 권고

### A-1. MDS Task Force on Technology (Espay 2019) [확정]
- **Movement Disorders 2019**, DOI 10.1002/mds.27671. PMC6520192.
- 4가지 권고: 환자 중심 결과 정의 / 부담↔효용 균형 / 개방형 플랫폼 / 규제 경로
- Modality 권고: **passive 모니터링 선호**. 능동 task로 finger tapping, spiral drawing, digital diary 명시.
- 핵심: **개인 baseline 대비 변화로 제시**(인구집단 평균 비교 금지) — 불안 유발 방지

### A-2. MDS 디지털 모빌리티 합의 (2025) [확정]
- PMC12447593. **걷기(gait) 기반 DMO를 임상 의사결정 보조용으로 사용 가능** 합의. 단 단독 진단 endpoint는 아직 권고 X.

### A-3. AAN Telehealth Position Statement (2021) [확정]
- *Neurology* 2021-05-13, DOI 10.1212/WNL.0000000000012185
- PD 신경퇴행성 질환에서 **수동 스마트폰 센서 비침습 원격 모니터링 명시 지지**. 추가 연구 필요로 등급 제한.

### A-4. NICE NG71 (2017) + DG51 (2023) [확정]
- DG51: 원격 연속 모니터링 디바이스의 비용효과성 평가 진행 중.

### A-5. 대한신경과학회/KMDS [확정 = 부재]
- neuro.or.kr, kmds.or.kr, KCI/임상진료지침정보센터에서 **PD 원격 모니터링/스마트폰 자가측정 공식 입장문 확인 안 됨** (2026-05).
- 질병관리청 "닥터 파킨슨 앱" 정부 보급(자가진단·증상기록), nih.go.kr nttId=3816. 가이드라인 수준 X.
- **시사점**: 학회 가이드라인 공백 = 정합성 리스크 낮음, 동시에 학회 권위 마케팅도 어려움

---

## B. 임상시험 endpoint 활용

### B-1. mPower (Bot 2016) [확정]
- *Sci Data* 2016;3:160011, DOI 10.1038/sdata.2016.11, PMC4776701
- 9,520명 동의, 8,320명 ≥1회 참여
- **6개월 ≥5일 지속 13%** (87% 이탈) — 자유 등록·자율 환경
- 5 modality: 탭핑(8,003명) / 음성(5,826명) / 보행(3,101명) / 기억(968명) / 설문

### B-2. Roche PD Mobile App v2 — PASADENA Phase II [확정]
- *Sci Rep* 2022, DOI 10.1038/s41598-022-15874-4, PMC9287320
- N=316 early PD, 10개 능동 task
- **중앙값 test-retest ICC 0.90** (0.75–0.95). Hand Turning 0.95 최고
- **MDS-UPDRS 상관 ρ 0.12–0.71** (Rest tremor 0.71)
- **일 5.3분, 순응도 96.29%** (감독 환경)
- PASADENA 결과 (npj Digital Med 2025, DOI 10.1038/s41746-025-01572-8): **MDS-UPDRS는 prasinezumab 진행 둔화 못 잡았으나 디지털 측정은 잡음**

### B-3. WATCH-PD (12개월, 2024) [확정]
- *npj PD* 2023 baseline (DOI 10.1038/s41531-023-00497-x), 2024 12-mo (DOI 10.1038/s41531-024-00721-2)
- N=82 early untreated PD + 50 대조, smartwatch+smartphone
- **수동 진전 비율과 rest tremor amplitude r=0.86** (가장 강한 상관)
- **digital sensors가 MDS-UPDRS-III보다 15개월 내 progression을 더 일찍 검출**

### B-4. Parkinson@Home Validation (Evers 2020) [확정]
- *JMIR* 2020, DOI 10.2196/19068
- ON/OFF 변별: 발목 센서 AUC 0.82, 모든 위치 결합 0.84
- 가속도계 **0.5–10 Hz total power**가 도파민 작용제에 가장 민감

### B-5. CloudUPDRS (CUSSP, 2020) [확정]
- *npj PD* 2020, DOI 10.1038/s41531-020-00135-w
- 저가 스마트폰 센서만으로 임상등급 정확도 달성 입증 → **고가 wearable 없이도 가능 근거**

### B-6. FDA DDT 인증 현황 (2025) [확정]
- *Clin Pharmacol Ther* 2025, PMC11652808
- **2026-05 현재 PD digital endpoint 중 DDT 정식 qualification 사례 없음**. 다수가 LoI 단계. Secondary/exploratory 위치.

---

## C. Modality별 검증

### C-1. 손가락 탭핑 [확정]
- *PLOS One* 2016, DOI 10.1371/journal.pone.0158852: N=57 PD + 87 대조, 기계식 비교 유의차
- WATCH-PD: ICC 0.28(클리닉·비주손) ~ 0.95(자택·주손) — **자택·주손에서만 신뢰**
- *J Neural Transm* 2023, DOI 10.1007/s00702-023-02659-w: ON 상태 ICC 0.707–0.975, **levodopa response 변별**

### C-2. 음성 (sustained vowel /아/) [확정]
- Little MA, *IEEE TBME* 2009: jitter/shimmer/HNR + SVM **91% 정확도**. UCI dataset 공개.
- Tsanas, *IEEE TBME* 2012: 원격 자가녹음 **99% 정확도**
- **한국어 검증**: Lee H et al., *Bioengineering* 2023, DOI 10.3390/bioengineering10080984, PMC10451837. N=101 한국인 PD, /아/ 발성, 43 acoustic feature, **H&Y 분류 95.48%, AUC 0.985**
- 한국어 정상 임계값 (eksss 2020 pss-12-4-73): 남 jitter 0.414% / shimmer 11.21%, 여 0.361% / 10.59%
- **한계**: 노화·기능성 발성장애 구별 어려움

### C-3. 나선/필기 [확정]
- *J Neurol Sci* 2020, DOI 10.1016/j.jns.2020.116822
- 2025 scoping review (PubMed 40776580): essential tremor vs PD tremor 변별 가능
- 단 Roche PASADENA Draw A Shape이 MDS-UPDRS 상관 최저(ρ 0.12)

### C-4. 반응속도·인지 [확정]
- Roche eSDMT: ICC 0.75 (10개 task 중 최저, 학습 효과)

### C-5. 자세·보행 [확정]
- Mellone, *Gait Posture* 2012: 단일 스마트폰 허리 부착 iTUG 가능
- *PLOS One* 2017, DOI 10.1371/journal.pone.0175559: dual-task TUG + accelerometer fall risk 변별 87%
- **60대+ 낙상**: TUG ≥13.5초 fall risk 분기점

### C-6. 키스트로크 다이내믹스 [확정]
- *Sci Rep* 2018, DOI 10.1038/s41598-018-25999-0; PMC9904385; *Sci Adv* 2025 DOI 10.1126/sciadv.adt6631
- Passive·부담 zero. **60대+ 데이터 sparse**

### C-7. 표정 (masked face) [확정]
- *JMIR* 2021 DOI 10.2196/21037; *npj Digital Med* 2025 DOI 10.1038/s41746-025-01630-1 (ON/OFF 86% 정확도)
- **사회 수용성 낮음**, 한국 생체정보 규제 부담

---

## D. 한국 규제·법적 위치

### D-1. 식약처 의료기기 vs 웰니스 [확정]
- **「의료기기와 개인용 건강관리(웰니스)제품 판단기준」** mfds.go.kr seq=14685 (2×2 판단)
- **「디지털의료제품법」** 2024-01-23 공포 / 2025-01-24 시행. lsiSeq=259299
- 2025-05-07 디지털의료기기 가이드라인 6종 제·개정 (kodhia.or.kr cid=40 uid=5487)
- **분류**: 진단/치료/예측/모니터링 = 의료기기. **기록·라이프스타일·건강유지 = 비의료기기**

### D-2. PIPA 민감정보 [확정]
- 개인정보보호법 시행령 제18조 lsId=011468: 건강 정보, 유전정보, **생체인식 특징정보** 민감정보
- **음성, 얼굴, 보행 패턴 = 생체인식** → **별도 동의 필수** (분리 체크박스, 보존기간·이용목적 명시)
- 음성 원본은 **특징 추출 후 파기 또는 기기 내 저장** 권장

### D-3. 의료법 진단 행위 경계 [확정/추정]
- 의료법 제27조: 의료행위 의료인 외 금지
- **안전한 표현**: "어제보다 평균 탭 3회 적었어요", "7일 평균 그래프", "변화 큰 날 의료진 상담 권장"
- **금지 표현**: "OFF 상태입니다", "약효 떨어졌습니다", "악화 가능성"

### D-4. 식약처 디지털 치료기기 허가 사례 [확정]
- 1호 에임메드 솜즈 (불면증 CBT-I, 2023)
- 2호 웰트 WELT-I (불면증)
- **PD 디지털 치료기기 허가 사례: 2026-05 기준 없음**

---

## E. 환자 사용성·이탈

### E-1. 이탈률 [확정]
- mPower: 6개월 87% 이탈 (자유 등록)
- Roche v2 (감독): 순응도 96.29%, 5분/일
- **격차**: 보호자 동반·약효 추적 같은 강한 동기가 있으면 Roche에 근접 [추정]

### E-2. 피드백 가이드 [확정]
- Espay 2019: 개별 baseline 대비 변화로 제시 (인구집단 평균 비교 금지)
- *npj Digital Med* 2024, DOI 10.1038/s41746-024-01144-2: 연속 실시간 피드백은 불안·강박 유발 가능 → 빈도 조절·요약 제시

### E-3. 게임화 [확정/부분]
- PMC12252148 (2025): PD는 우울·무의욕 흔해 게임화가 motivation 핵심. 노인 코호트 효과 mixed.
- 노인: leaderboards 62.5%, streak 26.5% 참여. **경쟁형보다 개인 성취·일일 streak가 적합**

---

## F. 경쟁 앱 (2026-05)

### 글로벌 [확정]
- **StrivePD** — iOS 무료, Apple Watch FDA-cleared tremor/dyskinesia. 가장 가까운 경쟁자
- **Encora** — MIT 출신 wearable, DBS 대안 영역
- **Beats Medical** — 보행 cueing + 음성 + 손가락. 영국 NHS
- **CloudUPDRS / Strolll** — 임상연구·웰니스
- **Roche PD Mobile App** — 임상시험 전용
- **mPower 2.0** — 연구 플랫폼

### 국내 [확정]
- **닥터 파킨슨 앱** (질병관리청) — 정보·자가진단·증상기록. 약효 추적·디지털 측정 약함
- **SNUH 김한준 음성치료 앱** — 호흡·구강·음량 훈련. JMIR 2025. **치료(training)이지 측정(assessment) 아님** + 식약처 허가 X
- **국내 PD 디지털 바이오마커 + 약효 추적 + 보호자 연동 통합 앱: 시장 공백** [추정]

### 파킨온 차별화 [추정]
1. 약효추적 × 객관 지표 결합 (StrivePD 가장 근접, 한국어 미지원)
2. 보호자 연동 (한국 가족 케어 문화)
3. 한국어 음성 + 한국인 임계값 (Lee 2023 기반)

---

## G. 구현 가능성

### G-1. 음성 분석 — 서버 권장 [추정/기술 근거]
- jitter/shimmer/HNR는 Praat 알고리즘 reference → **parselmouth(Python) 서버 처리**
- meyda(JS)는 spectral feature 중심, jitter/shimmer 직접 미지원
- 파이프라인: RN/Expo 16kHz mono PCM 5초 → Supabase Storage → Edge Function/Cloud Run에서 parselmouth → **원본 자동 삭제**, 특징값만 저장 → 한국어 정상치 대비 변화만 표시 (절대값 진단 X)

### G-2. 탭핑/반응속도 — 클라이언트만으로 충분
- RN onTouchStart timestamp ±10ms (PD bradykinesia 100ms+ 차이엔 영향 적음)
- 표준 task: **두 사각형 교대 탭 10초** (CAPSIT-PD)

### G-3. 데이터 스키마 권장
```
measurements (id, user_id, type, started_at, med_phase enum('pre','30m','2h','other'), context jsonb, raw_path, deleted_at)
measurement_features (measurement_id, feature_key, value_numeric, value_jsonb)
medication_intakes (id, user_id, drug, dose_mg, taken_at, scheduled_at)
baseline_stats (user_id, feature_key, mean, sd, n, updated_at)
```

### G-4. 한국어 음성 리스크 [확정+추정]
- 학술 근거 존재 (Lee 2023 N=101 단일 코호트, AUC 0.985)
- 공개 한국인 PD 음성 데이터셋 **확인 안 됨** → 자체 수집 필요
- AIHub 노인 자유대화 음성 정상(dataSetSn=107) — 대조군 baseline 참고
- **완화**: 절대 임계값 판정 X, 개인 30일 z-score만

### G-5. Modality 선정 매트릭스

| Modality | 구현 | 검증 | 노인 부담 | 규제 리스크 | 약효추적 적합 |
|---|---|---|---|---|---|
| Finger tapping | 낮음 | 높음 (ICC 0.7–0.95) | 낮음 | 낮음 | **높음** |
| Voice /아/ | 중 (서버) | 높음 (95%) | 낮음 (5초) | 중 (생체) | 중 |
| Spiral | 중 | 중 | 중 | 낮음 | 낮음 |
| TUG/Gait | 중 | 높음 | **높음 (낙상)** | 낮음 | 중 |
| Reaction time | 매우 낮음 | 중 | 낮음 | 낮음 | 중 |
| Keystroke passive | 낮음 | 중 | 낮음 | 낮음 | 낮음 |
| Hypomimia 카메라 | 높음 | 낮음~중 | **거부감** | **높음** | 중 |

---

## 파킨온 의사결정 요약

### 1) Top 3 Modality (한국 60대+ PD + 약효추적 + 보호자 연동)
1. **손가락 탭핑 (10초 양손 교대)** — CAPSIT-PD, ICC 0.7–0.95, levodopa 변별 입증, RN 구현 단순, 규제 리스크 낮음
2. **음성 sustained /아/ 5초** — 한국인 95% 분류 정확도, 비침습. **PIPA 별도 동의 + 원본 파기 필수**
3. **자가 약효 기록 + 위 두 객관 지표 결합 ON/OFF 추세선** — Espay 권고 핵심, 보호자 화면 직관적

### 2) MVP 권고
**MVP-A (최소, 4–6주)**: 손가락 탭핑 단일 + 약효 기록
**MVP-B (권장, 2–3개월)**: 탭핑 + 음성 sustained vowel + 약효 기록
- 두 modality 결합으로 ON/OFF 변별력 ↑ (Parkinson@Home 결합 AUC 0.84)
- 국내 최초 "한국어 음성 분석 PD 앱" 차별화 [추정]

### 3) 의료기기 회피 디스클레이머 (사용 권장)
```
본 앱은 의료기기가 아닙니다. 측정 결과는 사용자의 일상 변화 기록을 돕기 위한
참고 정보이며, 파킨슨병의 진단·치료·예방·예후 판정을 목적으로 하지 않습니다.
증상 변화에 대한 의학적 판단과 약물 조정은 반드시 담당 의료진과 상담하시기 바랍니다.

(개인정보 처리 안내) 음성 녹음은 분석을 위해 일시 저장되며, 분석 후 7일 이내
자동 삭제됩니다. 음성·신체 측정 정보는 「개인정보 보호법」 제23조 민감정보에 해당하여
별도의 동의를 받아 처리합니다.
```

운영 원칙:
- "정상/이상/악화/OFF/약효 떨어짐" 단어 **금지**
- 자동 alert에 의학적 판단 문구 금지

### 4) 한국어 음성 리스크
- 단일 코호트 100명 한국인 검증만 존재
- 공개 데이터셋 없음 → 자체 수집 필요
- MVP: 개인 30일 z-score만, 절대 임계값 판정 X
- 1–2년 내 국내 임상기관 협업으로 100–300명 코호트 구축 권장

### 5) 차후 로드맵
- 0–3개월: MVP-B 출시
- 3–6개월: 60대+ PD 100명 베타, retention 검증
- 6–12개월: 한국어 음성 자체 코호트, baseline 학습 ML
- 12–18개월: 국내 임상 보조 지표 채택 시도
- 18–24개월: SaMD Class I/II 검토, 식약처 디지털의료기기 허가 트랙
- 24개월+: Apple Watch / Galaxy Watch wearable 통합

---

## 핵심 1차 출처

- Espay AJ et al. Mov Disord 2019. DOI 10.1002/mds.27671. PMC6520192
- Bot BM et al. Sci Data 2016;3:160011. DOI 10.1038/sdata.2016.11
- Lipsmeier F et al. Sci Rep 2022. DOI 10.1038/s41598-022-15874-4
- Adams JL et al. WATCH-PD baseline npj PD 2023 DOI 10.1038/s41531-023-00497-x; 12-mo 2024 DOI 10.1038/s41531-024-00721-2
- Pagano G et al. PASADENA npj Digital Med 2025 DOI 10.1038/s41746-025-01572-8
- Evers LJW et al. JMIR 2020 DOI 10.2196/19068
- Stamford JA et al. CloudUPDRS npj PD 2020 DOI 10.1038/s41531-020-00135-w
- Little MA et al. IEEE TBME 2009 (UCI dataset)
- Lee H et al. Bioengineering 2023 DOI 10.3390/bioengineering10080984
- Lee EC et al. PLOS One 2016 DOI 10.1371/journal.pone.0158852
- 한국어 정상치 Phonetics and Speech Sciences 2020 pss-12-4-73
- AAN Telehealth Neurology 2021 DOI 10.1212/WNL.0000000000012185
- 「디지털의료제품법」 lsiSeq=259299
- 「의료기기-웰니스 판단기준」 mfds.go.kr seq=14685
- PIPA 시행령 제18조 lsId=011468
