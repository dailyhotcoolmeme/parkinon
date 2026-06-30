# 복용·알림 메뉴 3등분 재설계 — 스펙

상태: **구현 시작** (2026-06-16 오너 "이대로 작업 시작해")
그림: `docs/mockups/med_ia_screens.html`, IA: `docs/mockups/... ia_proposal`
관련: `MenuScreen`, `MedicationManageScreen`, `SettingsScreen`, `DoseSlotSetList`, `MenuNavigator`

## 문제 (확정)
- "복용약 관리"에 약 CRUD + 슬롯(시각·알림·약효추적·약넣기)이 섞여 한 화면 토글로 헷갈림.
- 슬롯 편집(DoseSlotSetList)이 "복용약 관리"·"알림 설정" **두 메뉴에 중복** 임베드.

## 결정: 관리 메뉴를 3등분 (중복 제거)
1. **내 약** (약만): 약 등록(처방전/직접) · 내 약 목록(수정/중단) · 지난 약 기록. **시간·알림 일절 없음.**
   - = 기존 MedicationManage 뷰 B(약 등록·관리 페이지). 단독 화면/메뉴.
2. **복용 시간·알림** (시간+약넣기): 복용 시간대(슬롯) 카드마다 [시각 · 약 복용 알림 토글 · 약효추적 토글 · 그 시간에 먹는 약 넣기]. **시간/알림/약효추적/약넣기의 단일 집.**
   - = 기존 MedicationManage 뷰 A(슬롯 카드 + 약 넣기) + DoseSlotSetList(시각·알림·약효추적)를 **슬롯 카드에 통합**(인라인 토글). 상세(인터벌·알림음)는 카드에서 진입.
3. **그 밖의 알림** (나머지): 전체 알림 켜기 · 약 미복용(1·2차) · 운동 알림 · 보호자 알림 · 알림음.
   - = 기존 "알림 설정"(SettingsScreen)에서 **DoseSlotSetList(슬롯) 제거** + 나머지 유지.

## 단계
- **1단계 (구조 분리):** 메뉴 항목 변경(복용약 관리→"내 약"+"복용 시간·알림", 알림 설정→"그 밖의 알림"). MedicationManage를 mode('meds'|'slots')로 두 메뉴가 각 뷰로 직행(showAllMeds 토글 의존 제거). SettingsScreen에서 DoseSlotSetList 제거.
- **2단계 (시간·알림 카드):** 슬롯 카드에 약 복용 알림/약효추적 토글 인라인(그림 ②)·약 넣기·시각 바꾸기·상세 진입.
- 각 단계 검증·배포.

## 보존 (절대)
- 약↔슬롯 매핑(medication_dose_slots)·dose_slots 단일소스·약효추적 큐·복용직후/변비 게이팅·미배정 배너·게이팅(setup)·홈/알림/복용기록·DrugInfoModal·처방전 OCR·daily_count·이력(ended_at).
- 보호자 대리 편집(SettingsScreen 보호자 뷰)에서 슬롯 편집을 빼면, 환자 슬롯 편집을 보호자가 "복용 시간·알림"에서 할 수 있게 동선 확인(보호자도 그 메뉴 접근).

## 용어
- 메뉴명: 내 약 / 복용 시간·알림 / 그 밖의 알림. 수정·삭제는 아이콘만(create-outline/trash-outline, CLAUDE.md 규칙).
