# 처방전·약물 관리 시스템 설계

## 배경
현재 `medications` 테이블은 한 행 = 한 약, `created_at/ended_at` 기반 추가/중단만 표현. 처방전 갱신(특히 OCR 일괄 등록) 시 변동 없는 약까지 "중단→재추가"로 잡히거나 용량·시기 변경을 놓침.

## 목표
- 처방전 단위 스냅샷으로 변경 이력 정확화 (추가/중단/용량변경/시기변경 4종)
- EDI코드 기반 약 동일성 판별
- 파킨슨 핵심약 PK 데이터로 효과 추적 자동 제안

## 데이터 모델

### 1. prescriptions (처방전 스냅샷)
```
id              uuid PK
patient_id      uuid
issued_at       date         -- 처방일
hospital        text
source          text         -- 'ocr' | 'manual'
image_url       text         -- 원본 처방전 사진
raw_ocr_text    text         -- OCR 원문 보존
created_at      timestamptz
```

### 2. prescription_items (처방전 내 약별 라인)
```
id              uuid PK
prescription_id uuid FK
edi_code        text         -- 건보 EDI코드 (예: 664601180)
product_name    text         -- 표시용 약품명
dose_per_take   numeric      -- 1회 투약량 (정/캡슐 수)
takes_per_day   int          -- 1일 투여횟수
total_days      int          -- 처방 일수
timing_slots    jsonb        -- ["morning","lunch","dinner","bedtime"]
meal_relation   text         -- 'before' | 'after' | 'none'
free_text       text         -- 용법 원문 ("아침 식사 후 복용하십시오")
```

### 3. medication_pk_profile (파킨슨 약효 프로파일)
```
edi_code         text PK
drug_class       text          -- 'levodopa' | 'dopamine_agonist' | 'mao_b_inhibitor' | 'comt_inhibitor' | ...
onset_min        int           -- 효과 발현 시간(분)
tmax_min         int           -- 최고혈중농도 도달 시간(분)
duration_min     int           -- 작용 지속 시간(분)
suggested_slots  jsonb         -- 약 복용 후 체크 권장 시점 (분): [0, 30, 120, 240]
notes            text          -- 공복 복용 등 특이사항
```

## 핵심 로직

### 처방 등록 시 diff
새 처방 스냅샷 들어오면 직전 스냅샷과 (edi_code, dose_per_take, takes_per_day, timing_slots) 비교 → 4종 변경 자동 산출:
- 추가: 이전엔 없던 edi_code
- 중단: 이전엔 있고 새 처방엔 없는 edi_code
- 용량변경: dose_per_take 또는 takes_per_day 차이
- 시기변경: timing_slots 차이

### EDI코드 매핑
- 1순위: OCR로 EDI코드 직접 추출 (모든 한국 처방전에 표기됨)
- 2순위: 식약처 의약품정보 API로 EDI → 성분/강도 보강
- 3순위: 약품명 fuzzy 매칭 (LLM 보조)

### 용법 자유텍스트 → timing_slots
- 1차: 정규식/키워드 룰 (아침/점심/저녁/취침/식전/식후)
- 2차: LLM 분류 (애매한 케이스: "기상 직후", "매 8시간마다" 등)

### 약효 추적 자동 제안
처방 등록 → 각 item의 edi_code로 medication_pk_profile 조회 → suggested_slots 기준 알림·기록 슬롯 자동 세팅. 사용자 기록 누적 시 개인 평균으로 보정.

## 단계별 실행

### Phase 1: PK 프로파일 수동 구축 ✅ 완료 (2026-05-16)
- `medication_pk_profile` 테이블 생성
- 파킨슨 핵심약 18종 시드 (시네메트/마도파/미라펙스/리큅/콤탄/아질렉트/아만타딘/온젠티스/자듀스 등)
- EDI코드는 실제 처방 등록 시 매칭하면서 채움
파킨슨 핵심약 20~30종 medication_pk_profile 수동 입력. (시네메트 속방/CR, 마도파/HBS, 미라펙스, 리큅, 콤탄, 아질렉트 등)

### Phase 2: 테이블 + diff 로직 — 스키마 완료 (2026-05-16)
- `prescriptions` / `prescription_items` 테이블 생성 + RLS (`is_same_group` 헬퍼 사용)
- 기존 `medications`는 그대로 유지 (마이그레이션 미정)
- **남은 작업**: diff 계산 함수, 처방 등록 시 medication_pk_profile 자동 매칭, medications 테이블과의 동기화 정책 결정

### Phase 3: OCR 등록 UI
처방전 촬영 → Google Vision 또는 GPT-4V로 EDI코드·약품명·용법 추출 → 사용자 확인 → prescriptions 저장.

### Phase 4: 식약처 API 보강
EDI코드만 잡혔을 때 식약처 의약품정보 API로 성분/강도 자동 채움. 신약·일반약 대응.

## 파킨슨 PK 참고 데이터 (Phase 1 초안)
| 약 | drug_class | onset | tmax | duration |
|---|---|---|---|---|
| 시네메트 속방 | levodopa | 20~40분 | 30~60분 | 240~360분 |
| 시네메트 CR | levodopa | 60~90분 | 120분 | 360~480분 |
| 마도파 HBS | levodopa | 90분 | 180분 | 360~480분 |
| 미라펙스 | dopamine_agonist | 60~120분 | 60~180분 | 480분 |
| 리큅 | dopamine_agonist | 60~120분 | 90분 | 360~480분 |
| 콤탄 (엔타카폰) | comt_inhibitor | 보조 | 60분 | 레보도파 연장 |
| 아질렉트 | mao_b_inhibitor | 누적효과 | 30~60분 | 24시간 (1일 1회) |
