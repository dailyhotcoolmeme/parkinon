# 약효추적 시간 추천 기능 설계 (Med Effect Tracking Recommendation)

작성일: 2026-05-18
최종 갱신: 2026-05-18 (Phase 1·1-bis·2·3-4 구현 완료 + §13-6 종결 반영 — §13-6 사용자 수정값 보존 판정 기준 오너 확정(추천 적용 후 사용자가 시점 ON/OFF·시간변경·추가·삭제 중 하나라도 하면 userEdited=true, 이후 재추천은 자동 무덮어쓰기·비강제 제안 다이얼로그·명시 선택 시에만 교체)으로 ✅ 종결 / 구현 현황 섹션(§14) 신설 / 재추천 트리거 확정(약 추가·삭제·계열·제형·용량 변경 모두 비강제 제안, 레보도파 0개 시 강제변경 없이 안심 안내) / 서버 푸시 경로 전 Phase 무수정 재확인 / 오픈이슈 카운트 해결 6건·미해결 4건으로 갱신 / 이전: §7-X Phase 2 온보딩 추천 카드 확정 UX, §13-2 옵션1(Phase 2)·사용자 수정값 보존 Phase 4 분리)
상태: Phase 1·1-bis·2·3-4 구현 완료 (오너 승인 완료) — §14 구현 현황 참조
관련 문서: CLAUDE.md, DESIGN_SYSTEM.md, AGENTS.md, docs/prescription_medication_spec.md, docs/NOTIFICATION_FLOW.md

> **갱신 요약(2026-05-18 1차)**: ① 사용자 상태별 정책(신규/약없음 차단/약 변경 대응) 신설 ② 추적 대상을 **레보도파 계열로 한정**(아키텍처 결정) ③ 추천=비강제 절대 원칙 명문화 + 사용자 수정 플래그 데이터 모델 추가 ④ 추천 근거 표시를 "근거 문구 + 식약처 원문 직접 링크(ITEM_SEQ 기반)"로 확정, 출처 사칭 금지 ⑤ ITEM_SEQ 파싱 현황 점검 결과 반영. 기존 큐레이션 테이블·서버 큐 구조는 그대로 유지.

> **갱신 요약(2026-05-18 2차 — 오너 추가 확정)**: ⑥ **알림 개수 캡 정책 확정**: 시스템 인위적 상한 없음. 추천 시점을 제시하되 각 시점을 개별 토글로 켜고/끌 수 있게 함. "캡"은 시스템 강제가 아닌 사용자 선택의 결과(§13-3 오픈이슈 해결). ⑦ **식약처 ITEM_SEQ 실응답 검증 완료**: 낱알식별 API 응답에 `ITEM_SEQ`(9자리 숫자 문자열) 항상 포함 확인(퍼킨정25-100mg=199201045, 리큅정1mg=200108699). ⑧ **의약품안전나라 상세 URL 확정**: `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq={ITEM_SEQ}`(§13-9 오픈이슈 해결). ⑨ **핵심 설계 결정**: 추천 카드는 실시간 재검색하지 않고, **약 등록 시점에 ITEM_SEQ를 받아 medications 레코드에 저장**(약명 매칭 실패 위험 회피). ⑩ **DB 스키마 변경 발생**: `medications.item_seq`(text, nullable) 컬럼 1개 추가 필요(Supabase 마이그레이션, 서버측 → OTA 무관). 기존 "DB 스키마 변경 불필요" 서술 정정.

---

## 1. 배경 · 목표

### 배경
- 현재 약효추적(약 복용 후 컨디션 확인) 알림은 **모든 약에 동일하게 복용 후 30분·2시간 고정 기본값**(`DEFAULT_MED_NOTIFS = [{30}, {120}]`)을 사용한다.
- 파킨슨 약은 제형(속효성/서방형/복합제/패치/MAO-B 등)에 따라 약효 발현·지속 시간이 크게 다르다. 일률적 30분/2시간 추적은 환자별 약 특성을 반영하지 못한다.
- 처방전 OCR / 직접 입력 시 식약처 낱알식별 API(`MdcinGrnIdntfcInfoService03`) 및 e약은요 API를 호출해 성분/분류(CLASS_NAME)를 이미 가져오고 있으나, 이 정보가 약효추적 추천에 활용되지 않고 있다.

### 목표
- 등록되는 약의 **성분/분류를 기준으로 약효추적 권장 시점을 자동 추천**하여 알림 설정의 기본값으로 채운다.
- 추천은 강제가 아니며 환자가 자유롭게 추가/변경/삭제 가능 (기존 커스터마이징 구조 100% 재사용).
- "기본 추천 — 주치의와 상의해 조정하세요" 디스클레이머를 반드시 노출하여 의료 안전을 확보한다.
- 매칭 실패 시 기존 기본값(복용 후 30분·2시간)을 그대로 유지하여 회귀(regression) 없음.

---

## 2. 식약처 API 한계 요약

| 항목 | 현황 |
|---|---|
| 사용 중 API | `MdcinGrnIdntfcInfoService03`(낱알식별) + e약은요(`DrbEasyDrugInfoService`) |
| 추출 가능 필드 | `ITEM_NAME`(품명), `ENTP_NAME`(업체), `CLASS_NAME`(분류명, 예: "기타의 중추신경용약"), `ETC_OTC_NAME`, `CHART`(성상), `DRUG_SHAPE`, 색상, 식별표기 |
| 핵심 한계 | 식약처 API는 **약동학(PK) 데이터(onset/tmax/duration)를 제공하지 않음**. `CLASS_NAME`도 ATC 코드처럼 정밀하지 않고 "기타의 중추신경용약" 수준으로 뭉뚱그려진 경우가 많아 레보도파 IR/CR/복합제 구분이 불가능 |
| 성분명 | 낱알식별 API 응답에 단일 성분 필드가 없음. e약은요의 효능/용법 텍스트로 추정해야 하며 신뢰도 낮음 |
| 결론 | 식약처 분류만으로는 추천 불가 → **내부 큐레이션 테이블(품명/성분 키워드 → 권장 오프셋 매핑) 필수**. 식약처 응답은 보조 신호로만 사용 |

> 참고: 원격 Supabase에는 이미 `medication_pk_profile` 테이블(파킨슨 핵심약 18종 시드, `suggested_slots`/`onset_min`/`tmax_min`/`drug_class`/`ingredient`/`edi_code`)이 존재하며 `MedicationManageScreen.tsx`의 OCR 비교 다이얼로그에서 "복용 후 N분 시점 기록 권장" tip 텍스트 표시에만 사용 중이다(알림 설정 자동 반영은 아직 미연동). 본 기능은 이 자산을 재활용·확장한다.

---

## 3. 확정 설계 결정 (변경 금지)

1. **추천 방식**: 성분 기반 큐레이션 테이블. 약명/성분 키워드 → 파킨슨 약 분류 → 권장 약효추적 오프셋(분 배열) 매핑. 매칭 실패 시 기본값(30분·2시간) 유지.
2. **적용 방식**: 추천 오프셋을 약효추적 알림 설정의 기본값으로 **표시만** 함. 자동 강제 적용 금지 — 사용자가 최종 수락/거절/수정. 환자가 추가/변경/삭제 가능 (기존 `medNotifs` 커스터마이징 구조 재사용).
3. **의료 안전**: 추천은 강제가 아닌 기본값이며 항상 수정 가능. 디스클레이머 필수. 60대 이상 타깃 UI 원칙(18sp+, 56dp+, 아이콘+텍스트, 작은 링크 금지) 준수.
4. **알림 인프라**: CLAUDE.md 규칙대로 **서버 푸시/큐 기반 약효추적 흐름(`queue-effect-tracking` Edge Function + `effect_tracking_queue` + `process-notification-queue`)을 그대로 사용**. 로컬 알림 대체 절대 금지.
5. **추적 대상 한정 (아키텍처 결정 — §3-A)**: 약효추적 알림은 **레보도파 계열 약만** 대상으로 한다. 도파민작용제·MAO-B억제제·COMT억제제·항콜린제·아만타딘 등 비레보도파 약은 약효추적 알림 대상에서 제외(추적 의의 낮음).
6. **약 종속 원칙 (§3-B)**: "약효추적 알림은 약에 종속된다. 등록된 약이 없으면 약효추적 알림은 존재할 수 없다." 약 없이 약효추적 알림만 따로 설정하는 경로는 차단한다.
7. **추천=비강제 절대 원칙 (§3-C)**: 추천은 추천일 뿐 강제가 아니다. 최종 선택권은 항상 사용자. 적용 후에도 시점 추가·변경·삭제 자유. 사용자가 직접 수정한 값은 사용자 동의 없이 자동으로 덮어쓰지 않는다(이를 위한 **사용자 수정 여부 플래그** 도입 — §8 데이터 모델).
8. **추천 근거 표시 정직성 (§3-D)**: 식약처 API는 추적 시간(분 단위 오프셋)을 제공하지 않으므로 "식약처 권장 시간"이라 표기하면 출처 사칭이 되어 **절대 금지**. 정직한 출처 계층 + 식약처 원문 직접 링크로만 안내한다(§4-A, §9).
9. **알림 개수 캡 — 시스템 캡 없음 (§3-E, 오너 확정)**: 시스템이 인위적 상한을 걸지 않는다. 우리는 추천 시점(레보도파 IR 기본 30분·1시간·2시간 등 큐레이션 테이블 값)을 제시할 뿐이고, **각 추적 시점을 개별로 켜고/끌 수 있는 UI**를 제공한다. 사용자가 1개·2개·3개 전부 등 원하는 만큼 직접 선택하며, "캡"은 시스템 강제가 아니라 사용자 선택의 결과다. 추천=비강제 원칙(§3-C)의 연장선.
10. **식약처 원문 링크 = 등록 시점 ITEM_SEQ 저장 방식 (§3-F, 오너 확정)**: 추천 카드는 약을 실시간 재검색하지 않는다. **약 등록 시점(낱알식별 API를 이미 호출하는 흐름)에서 `ITEM_SEQ`를 받아 `medications` 레코드에 저장**하고, 추천 카드·상세 보기는 저장된 값을 그대로 사용한다(약명 매칭 실패 위험 회피).

---

## 3-A. 추적 대상 범위 (핵심 아키텍처 결정)

- **레보도파 계열 약만 약효추적 대상**이다. 약효추적 알림 추천·자동 채움은 레보도파 계열(IR/CR/레보도파+엔타카폰 복합제)에서만 발생한다.
- 비레보도파 약(도파민작용제, MAO-B억제제, COMT억제제, 항콜린제, 아만타딘, 로티고틴 패치 등)은 약효추적 알림 대상에서 **제외(추적 비대상)**. 추적 의의가 낮고 잘못된 알림이 60대 사용자에게 혼선을 준다.
- **다약 환자도 레보도파 기준 1세트만 추적**한다. 여러 레보도파 약이 있어도 약효추적 알림은 레보도파 기준 단일 세트(오프셋 union)로 통합하며, 비레보도파 약은 union에서 제외한다.
- 단, **약 기본정보(성분·식약처 정보·식약처 원문 링크)는 추적 비대상 약을 포함한 모든 약에 제공**한다. "추적 비대상"은 약효추적 알림만 안 만드는 것이지, 약 정보 자체를 숨기는 것이 아니다.
- 큐레이션 테이블(§4)에서 비레보도파 분류는 "추적 비대상"으로 명확히 표기한다(기존 `active: false` + `note`로 사유 안내).

---

## 3-B. 사용자 상태별 정책 (출시 전 테스트 단계 — 기존 사용자 없다고 가정)

> 출시 전 테스트 단계이므로 "기존 사용자" 마이그레이션 시나리오는 없다고 가정한다. 출시 후 약 변경 대응(C)만 미래 대비로 설계한다.

### A. 신규 가입 (약 등록 직후)
- 약 등록 직후 추천값을 약효추적 알림 설정의 **기본값으로 표시만** 한다. **자동 강제 적용 금지**.
- 사용자가 최종 **수락/거절/수정**한다. 사용자가 명시적으로 적용(토글 ON·"추천 시간으로 설정" 버튼)해야 `medNotifs`에 반영된다.
- 온보딩에서도 추천 옵션은 화면에 표시되고 기본 ON으로 보이되, 사용자가 끄거나 바꿀 수 있으며 디스클레이머를 상시 노출한다.

### B. 약 등록 없이 알림만 따로 설정 → 차단
- 설계 원칙 명문화: **"약효추적 알림은 약에 종속된다. 등록된 약이 없으면 약효추적 알림은 존재할 수 없다."**
- 설정 화면에서 **등록 약이 0개면 약효추적 토글 진입을 차단**하고 "먼저 약을 등록해주세요" 유도(약 관리 화면으로 이동 버튼 제공).
- 이유: 이탈 방지 + 앱 가치(약 등록을 해야 약효추적·기록 보기·보호자 연동이 의미를 가진다).
- 등록 약이 있어도 **레보도파 계열이 0개**면(전부 비레보도파) 약효추적 추천은 생성되지 않으며, 토글은 노출하되 "현재 등록한 약은 약효추적 대상이 아니에요" 안내(§3-A).

### C. 출시 후 약 변경 대응 (미래 대비)
- 다음 변경 시 추천을 재계산한다:
  - **약물동태 프로필 변경**: IR↔CR 전환, 다른 계열로 변경, 레보도파 추가/제거
  - **복용량(용량) 변경**
- 재계산 결과가 현재 설정과 다르면 **"추천을 새로 적용할까요?"** 제안(강제 금지). 사용자가 직접 [새로 적용] / [그대로 둘게요] 선택.
- **사용자가 직접 수정했던 값은 사용자 동의 없이 자동으로 덮지 않는다**(§3-C, 사용자 수정 플래그 §8).

---

## 3-E. 알림 개수 캡 정책 — 시스템 캡 없음 (오너 확정 — 2026-05-18)

- **시스템이 인위적 상한을 걸지 않는다.** 우리는 추천 시점(레보도파 IR 기본 30분·1시간·2시간, CR 60분·180분, 복합제 30분·90분·180분 등 큐레이션 테이블 §4 값)을 **제시**할 뿐이다.
- **각 추적 시점을 개별로 켜고/끌 수 있는 UI**를 제공한다. 사용자가 1개만, 2개만, 3개 전부 등 원하는 만큼 직접 선택한다.
- **"캡"은 시스템 강제가 아니라 사용자 선택의 결과**다. 기존 "추천=비강제, 최종 선택·수정은 사용자"(§3-C) 원칙의 연장선.
- **추천 시점 표시 기본 상태**: 추천값을 기본 노출하되 각 시점을 개별 토글로 끌 수 있다(60대 UX 원칙 — 친절한 기본 + 쉬운 해제). 자동 강제 적용 아님(명시적 적용 동작 필요 — §3-B-A).
- 다약 union(§3-A) 결과 시점이 여러 개여도 시스템이 잘라내지 않는다. 모든 추천 시점을 개별 토글로 노출하고 사용자가 선택한다.
- **오픈이슈 정리**: 기존 §13-3 "다약/알림 개수 캡(오너 확인 필요)" → **해결됨: 시스템 캡 미적용, 사용자 개별 선택 방식**(미해결 목록에서 제거).

---

## 3-F. 식약처 원문 링크용 ITEM_SEQ — 등록 시점 저장 방식 (오너 확정 — 2026-05-18)

- 추천 카드에서 약을 새로 검색하면 약명 매칭 실패 위험이 크다("시네메트정" 등 정확명 검색 0건, 규격별 ITEM_SEQ 상이).
- 따라서 **약 등록 시점**(이미 낱알식별 API를 호출하는 `MedicationRegisterScreen` 흐름)에서 `ITEM_SEQ`를 받아 **DB(`medications` 레코드)에 저장**하고, 추천 카드·상세 보기는 저장된 `item_seq`를 그대로 사용한다. **추천 카드에서 실시간 재검색하지 않는다.**
- DB 영향: `medications` 테이블에 `item_seq`(text, nullable) 컬럼 추가 필요. **Supabase 마이그레이션(서버측)이며 앱 네이티브 무관 → OTA 배포에는 영향 없음**(§8, §12 반영).
- `DrugInfo` 인터페이스에 `itemSeq?: string` 파싱 추가를 `MedicationRegisterScreen.tsx`(`searchMfdsInfo`)·`MedicationManageScreen.tsx` 양쪽 구현계획에 명시(§12).
- 규격별 ITEM_SEQ 상이 → 등록 시 매칭된 첫 결과 기준 대표 링크가 실제 복용 규격과 다를 수 있는 한계는 리스크로 기록(§13-9).

---

## 4. 성분 → 오프셋 큐레이션 테이블

### 4.1 분류 정의 (임상 레퍼런스 기반 기본 추천값, 의학적 확정값 아님)

> **추적 대상 한정(§3-A)**: 약효추적 알림 추천은 **레보도파 계열만** 활성(`active: true`)이다. 비레보도파 분류는 전부 **"추적 비대상"(`active: false`)** — 약효추적 알림을 생성하지 않으나 약 정보·식약처 원문 링크는 모든 약에 제공한다.

| 분류 키 | 대표 약 (브랜드) | 권장 약효추적 오프셋 | 추적 대상 여부 |
|---|---|---|---|
| `levodopa_ir` | 시네메트, 퍼킨, 마도파(속방) IR | 복용 후 30분·60분·120분 | ✅ 추적 대상 (레보도파) |
| `levodopa_cr` | 시네메트CR, 마도파HBS, 레보도파 서방정 | 복용 후 60분·180분 | ✅ 추적 대상 (레보도파) |
| `levodopa_entacapone` | 스타레보 (레보도파/카르비도파/엔타카폰) | 복용 후 30분·90분·180분 | ✅ 추적 대상 (레보도파 복합제) |
| `dopamine_agonist` | 미라펙스(프라미펙솔), 리큅(로피니롤) | — | ❌ 추적 비대상 (비레보도파) |
| `rotigotine_patch` | 뉴프로 패치 (로티고틴) | — | ❌ 추적 비대상 (패치형·비레보도파) |
| `comt_inhibitor` | 콤탄(엔타카폰), 온젠티스(오피카폰) | — | ❌ 추적 비대상 (레보도파 동반약) |
| `mao_b_inhibitor` | 셀레길린, 아질렉트(라사길린) | — | ❌ 추적 비대상 (비레보도파) |
| `amantadine` | 아만타딘 | — | ❌ 추적 비대상 (비레보도파) |
| `anticholinergic` | 트리헥신(트리헥시페니딜) | — | ❌ 추적 비대상 (비레보도파) |

> 변경점: 이전 버전에서 `dopamine_agonist`/`amantadine`을 추적 적합으로 두었으나, 오너 확정 결정(§3-A)에 따라 **레보도파 계열만 추적 대상**으로 한정한다. 비레보도파 분류는 전부 추적 비대상으로 통일한다.

### 4.2 데이터 구조

`medication_pk_profile`(원격 기존 테이블)을 1순위로 사용하되, 거기에 매칭 안 되는 약을 위한 **앱 내장 fallback 큐레이션 상수**를 신규 추가한다.

```ts
// src/constants/medEffectProfiles.ts (신규)

/** 약효추적 추천 결과 */
export type TrackingRecommendation = {
  drugClass: DrugClass;
  /** 권장 약효추적 오프셋(분). 빈 배열 = 추적 기본 OFF */
  offsets: number[];
  /** 추천 활성 여부. false면 알림 설정 자동 채움 비활성 */
  active: boolean;
  /** UI에 띄울 분류별 안내 문구 (디스클레이머와 별개의 분류 특이사항) */
  note?: string;
};

export type DrugClass =
  | 'levodopa_ir' | 'levodopa_cr' | 'levodopa_entacapone'
  | 'dopamine_agonist' | 'rotigotine_patch' | 'comt_inhibitor'
  | 'mao_b_inhibitor' | 'amantadine' | 'anticholinergic';

/** 분류 → 추천 오프셋 매핑 (임상 레퍼런스 기반 기본 추천값)
 *  추적 대상 한정(§3-A): 레보도파 계열만 active:true. 비레보도파는 전부 추적 비대상(active:false). */
export const CLASS_RECOMMENDATION: Record<DrugClass, TrackingRecommendation> = {
  // ── 추적 대상 (레보도파 계열만) ──
  levodopa_ir:         { drugClass: 'levodopa_ir',         offsets: [30, 60, 120], active: true },
  levodopa_cr:         { drugClass: 'levodopa_cr',         offsets: [60, 180],     active: true },
  levodopa_entacapone: { drugClass: 'levodopa_entacapone', offsets: [30, 90, 180], active: true },
  // ── 추적 비대상 (비레보도파 — 약효추적 알림 미생성, 약 정보·식약처 링크는 제공) ──
  dopamine_agonist:    { drugClass: 'dopamine_agonist',    offsets: [], active: false,
                          note: '이 약은 약효추적 알림 대상이 아니에요. 레보도파 약 기준으로 추적해요.' },
  rotigotine_patch:    { drugClass: 'rotigotine_patch',    offsets: [], active: false,
                          note: '붙이는 약(패치)이라 복용 후 추적 알림이 맞지 않아요.' },
  comt_inhibitor:      { drugClass: 'comt_inhibitor',      offsets: [], active: false,
                          note: '레보도파와 함께 드시는 약이에요. 레보도파 기준으로 추적해요.' },
  mao_b_inhibitor:     { drugClass: 'mao_b_inhibitor',     offsets: [], active: false,
                          note: '이 약은 약효추적 알림 대상이 아니에요.' },
  amantadine:          { drugClass: 'amantadine',          offsets: [], active: false,
                          note: '이 약은 약효추적 알림 대상이 아니에요.' },
  anticholinergic:     { drugClass: 'anticholinergic',     offsets: [], active: false,
                          note: '이 약은 약효추적 알림 대상이 아니에요.' },
};

/** 약명/성분 키워드 → 분류 매핑 (소문자·공백제거 후 includes 매칭) */
export const KEYWORD_TO_CLASS: { keywords: string[]; cls: DrugClass }[] = [
  { cls: 'levodopa_entacapone', keywords: ['스타레보', 'stalevo'] },
  { cls: 'levodopa_cr',         keywords: ['시네메트cr', 'cr정', '서방', 'hbs', '마도파hbs', '서방형'] },
  { cls: 'levodopa_ir',         keywords: ['시네메트', '퍼킨', '마도파', '레보도파', 'levodopa', 'sinemet', 'madopar'] },
  { cls: 'dopamine_agonist',    keywords: ['미라펙스', '프라미펙솔', 'pramipexole', '리큅', '로피니롤', 'ropinirole', 'mirapex', 'requip'] },
  { cls: 'rotigotine_patch',    keywords: ['뉴프로', '로티고틴', 'rotigotine', 'neupro', '패치'] },
  { cls: 'comt_inhibitor',      keywords: ['콤탄', '엔타카폰', 'entacapone', '온젠티스', '오피카폰', 'opicapone', 'comtan'] },
  { cls: 'mao_b_inhibitor',     keywords: ['셀레길린', 'selegiline', '아질렉트', '라사길린', 'rasagiline', 'azilect'] },
  { cls: 'amantadine',          keywords: ['아만타딘', 'amantadine', 'pk-merz', '피케이멜츠'] },
  { cls: 'anticholinergic',     keywords: ['트리헥신', '트리헥시페니딜', 'trihexyphenidyl', '벤즈트로핀', 'benztropine'] },
];
```

> ⚠️ 큐레이션 테이블 수치는 **의학적 확정값이 아닌 기본 추천**이며, UI에 반드시 "주치의 상의" 디스클레이머를 노출한다.

---

## 4-A. 추천 근거 표시 — 출처 정직성 (의료앱 — 매우 중요)

### 절대 금지
- 식약처 API(낱알식별/e약은요)는 **추적 시간(분 단위 오프셋)을 제공하지 않는다.** 따라서 추천 오프셋을 "식약처 권장 시간"이라고 표기하면 **출처 사칭** → 절대 금지.
- "식약처가 30분/2시간을 권장한다"류 문구 전면 금지. 추천 수치의 출처는 어디까지나 앱 내부 큐레이션 + 파킨슨병 일반 진료 권고다.

### 정직한 출처 계층

| 정보 | 정직한 출처 표기 |
|---|---|
| 약효 발현·지속 (Tmax·지속시간) | "식약처 의약품 허가정보상 약효 특성 참고" 수준 문구 (수치 단정 금지) |
| 약 기본정보 (성분·효능·용법) | 식약처 의약품안전나라 / e약은요 (원문 직접 링크) |
| 약효추적(wearing-off) 개념 | 파킨슨병 일반 진료 권고 참고 |
| 추천 오프셋 수치 자체 | 앱 내부 큐레이션(임상 레퍼런스 기반 기본 추천) — "식약처 권장"이라 하지 않음 |

### 확정 표시 방식 — "근거 문구 명시 + 식약처 원문 직접 링크"

추천 카드에 아래 둘을 함께 둔다:

**(a) 근거/면책 문구 (추천 카드 본문)**
> "이 시간은 **OO약의 식약처 허가정보상 약효 특성과 파킨슨병 일반 진료 권고를 참고한 추천**이에요.
> 환자분 상태에 따라 다를 수 있으니 주치의와 상의해 조정하세요."

**(b) 식약처 원문 직접 보기 버튼**
- 버튼 라벨: **"📄 식약처 약 정보 직접 보기"** (아이콘+텍스트, 56dp 이상, 작은 링크 금지 — §60대 UI)
- 동작: **약 등록 시점에 medications 레코드에 저장해 둔 `item_seq`** 를 이용해 의약품안전나라 해당 약 상세 페이지를 **외부 브라우저로 오픈**(`Linking.openURL`). WebView 사용 안 함(의약품안전나라 페이지가 무거움).
- 추천 시간 자체를 "식약처가 정한 값"으로 제시하지 않고, 사용자가 식약처 원문을 직접 확인하도록 경로만 제공한다(투명성).
- **추천 카드에서 약을 실시간 재검색하지 않는다**(§4-A 핵심 설계 결정). 저장된 `item_seq`를 그대로 사용한다. 사유: "시네메트정" 등 정확명 검색 0건, 규격별 ITEM_SEQ 상이 → 카드에서 재검색하면 약명 매칭 실패 위험이 큼.

### 추천 카드 예시 문안 · 버튼 구성

```
┌─────────────────────────────────────────────┐
│ 💊 시네메트정 약효추적 추천                   │  ← 제목 18sp+
│                                              │
│ 복용 후 30분 · 1시간 · 2시간 확인을           │  ← 추천 시점 18sp+
│ 권장해요.                                     │
│                                              │
│ ⓘ 이 시간은 시네메트정의 식약처 허가정보상     │  ← 근거/면책 문구
│   약효 특성과 파킨슨병 일반 진료 권고를        │     (경고 카드 스타일
│   참고한 추천이에요. 환자분 상태에 따라 다를    │      #FFF3E0 / borderLeft
│   수 있으니 주치의와 상의해 조정하세요.        │      #FF9800)
│                                              │
│ [ 📄 식약처 약 정보 직접 보기 ]               │  ← 56dp+ 버튼, 외부링크
│                                              │
│ [ 그대로 둘게요 ]   [ 추천 시간으로 설정 ]     │  ← 56dp+ 선택 버튼 2개
└─────────────────────────────────────────────┘
```

- 모든 텍스트 18sp+, 버튼 56dp+, 아이콘+텍스트 동반, 작은 텍스트 링크 금지(60대 UI 원칙, CLAUDE.md).
- "추천 시간으로 설정"을 눌러야만 `medNotifs`에 반영(자동 강제 적용 금지 — §3-B-A).

### 의약품안전나라 약 상세 URL 패턴 (검증 완료 — 2026-05-18)

- **ITEM_SEQ 수신 검증 완료**: 식약처 낱알식별 API(`MdcinGrnIdntfcInfoService03`) 실응답에 `ITEM_SEQ`(9자리 숫자 문자열)가 **항상 포함됨**을 실응답으로 확인.
  - 예: 퍼킨정25-100mg = `199201045`, 리큅정1mg = `200108699`
  - 현재 코드는 이 필드를 파싱하지 않음 → **파싱 추가가 구현 선행 작업**(§13-8).
- **상세 URL 확정**:
  - `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq={ITEM_SEQ}`
  - 서버가 `cacheSeq`로 자동 302 리다이렉트하므로 **클라이언트는 ITEM_SEQ만 알면 됨**(추가 코드 산출 불필요).
- **폴백(ITEM_SEQ가 없는 약)**: 약명 통합검색 `https://nedrug.mfds.go.kr/searchDrug?searchYn=true&keyword={URL인코딩 약명}`.
- **링크 오픈 방식 확정**: WebView 아닌 **외부 브라우저** `Linking.openURL`(의약품안전나라 페이지가 무거움).
- **규격별 ITEM_SEQ 상이 한계**: 동일 약명이라도 규격(용량)별로 ITEM_SEQ가 다름. 약 등록 시점에 매칭된 첫 결과 기준으로 저장되므로 대표 링크가 실제 복용 규격과 다를 수 있음 → §13-9에 리스크로 기록.
- 링크는 저장된 `item_seq` 기반 URL 문자열 조합만 사용하므로 **네이티브 변경 없음 → OTA 배포 가능**(앱측). 단 `medications.item_seq` 컬럼 추가는 Supabase 마이그레이션(서버측, OTA 무관).

---

## 5. 식약처 응답에서 분류 추출 방식

추천 분류 결정 우선순위 (`resolveTrackingRecommendation(medName, mfdsInfo?, ediCode?)`):

1. **EDI코드 → `medication_pk_profile` 조회** (OCR로 EDI 추출된 경우). `suggested_slots`가 있으면 그대로 오프셋 사용. (기존 MedicationManageScreen 로직 재사용)
2. **약명/성분 키워드 매칭** (`KEYWORD_TO_CLASS`): 약명(`medName`) + 식약처 `itemName` + e약은요 효능/용법 텍스트를 소문자·공백제거 후 키워드 부분일치. 가장 구체적인 분류 우선(스타레보 → CR → IR 순으로 배열 정렬).
3. **`medication_pk_profile` 품명/성분 ilike 조회** (fallback).
4. **매칭 실패** → `null` 반환 → 호출부에서 기존 기본값 `[{30}, {120}]` 유지.

식약처 `CLASS_NAME`은 정밀도가 낮아 **단독 분류 근거로 쓰지 않고**, 키워드 매칭 실패 시 "중추신경용약" 포함 여부로 파킨슨 약 가능성만 로깅(추천에는 미반영).

---

## 6. 알림 설정 연동 흐름

### 현재 흐름
- 약효추적 설정값은 전역 `SettingsContext.medNotifs: MedNotif[] = [{id, minutes, enabled}]`로 관리. AsyncStorage(`settings_med_notifs`) + DB `users.med_notif_prefs`에 저장.
- 복용 기록 시 `useMedication.takeMedication` → `queue-effect-tracking` Edge Function에 `notif_settings`(medNotifs의 minutes/enabled) 전달 → `effect_tracking_queue` INSERT → 크론이 `process-notification-queue`로 서버 푸시 발송.
- 기본값은 코드 상수 `DEFAULT_MED_NOTIFS`. 온보딩 `NotificationSetupScreen`은 자체 하드코딩 옵션(after30/after2h) 사용 — medNotifs와 분리되어 있음(개선 필요 지점).

### 변경 후 흐름
1. 약 등록(온보딩/약 관리) 완료 시점에 등록된 약 목록을 순회하며 `resolveTrackingRecommendation`으로 분류·오프셋 추천.
2. 여러 약이 있으면 **활성 추천 오프셋들의 합집합(union, 중복 제거·정렬)**을 추천 medNotifs 후보로 산출. 모든 약이 비활성(패치/MAO-B 등)이면 추천 없음 → 기존 기본값 유지.
3. 추천 결과를 `medNotifs`의 **초기 기본값으로 채움**(사용자가 아직 수동 변경한 적 없을 때만). 사용자가 한 번이라도 약효추적 설정을 수정했으면(`med_notif_prefs` DB 존재 또는 플래그) 추천으로 덮어쓰지 않음.
4. 추천 출처 메타(`recommendedFromClasses: DrugClass[]`)를 AsyncStorage(`med_notif_recommendation_meta`)에 저장하여 UI 안내·재추천 판단에 사용.
5. 서버 큐 흐름(`queue-effect-tracking`)은 **변경 없음** — medNotifs 값만 추천값으로 채워지므로 기존 인프라 그대로 동작.

> 추천 적용은 "medNotifs 기본값 결정 로직"에만 개입하며 서버 푸시 경로/Edge Function/큐 스키마는 손대지 않는다 → CLAUDE.md 알림 규칙 준수, 회귀 위험 최소화.

---

## 7. UI 변경점

### 7.1 온보딩 — NotificationSetupScreen
- 현재 하드코딩된 2개 옵션(after30/after2h)을 **추천 기반 동적 옵션**으로 교체.
- 화면 진입 시 `onboarding_medications`(AsyncStorage) 읽어 추천 계산 → 추천 오프셋들을 토글 옵션으로 표시(기본 ON).
- 상단에 안내 카드(경고 카드 스타일, `#FFF3E0` / `borderLeft #FF9800`):
  > "💊 등록하신 약에 맞춰 추천한 기본 시간이에요.\n주치의와 상의해 자유롭게 바꾸실 수 있어요."
- 분류별 `note`가 있으면 작은 보조 텍스트로 노출 (예: 패치/MAO-B 약 안내).
- 추천이 없을 때(매칭 실패/전부 비활성)는 기존 30분·2시간 옵션 그대로 + "기본 추천" 안내.
- 확정 시 추천값을 `medNotifs`에 반영(`setMedNotifs`)하도록 변경(현재는 별도 `onboarding_notifications`만 저장 → medNotifs 연동 추가).

### 7.2 약 관리 — MedicationManageScreen
- 약 추가/OCR 등록 후 추천 가능한 약이 있으면, 기존 PK tip Alert을 확장하여
  > "이 약은 복용 후 30분·1시간·2시간 확인을 권장해요. 약효추적 알림에 반영할까요?\n(주치의와 상의해 조정하세요)"
  [그대로 둘게요] / [추천 시간으로 설정]
- "추천 시간으로 설정" 선택 시에만 `setMedNotifs` 갱신. 강제 적용 안 함.

### 7.2-bis 약 등록·OCR 후 추천 카드 (근거 표시 — §4-A)
- §7.2의 추천 다이얼로그/카드는 §4-A의 "근거 문구 + 식약처 원문 직접 보기 버튼 + 선택 버튼 2개" 구성을 따른다.
- 추천은 **레보도파 계열 약에서만** 표시(§3-A). 비레보도파 약만 등록된 경우 추천 카드 미표시 + "이 약은 약효추적 알림 대상이 아니에요" 안내(분류 `note`).
- "추천 시간으로 설정"을 눌러야만 `setMedNotifs` 반영(자동 강제 금지 — §3-B-A).

### 7.3 설정 — SettingsScreen (약효 추적 알림 카드)
- **약 없음 차단(§3-B-B)**: 등록 약이 0개면 약효추적 토글/카드 진입을 차단하고 안내 카드 + "💊 약 등록하러 가기" 버튼(56dp+, 약 관리 화면 이동) 표시:
  > "약효추적 알림은 등록한 약에 맞춰 보내드려요. 먼저 약을 등록해주세요."
- 등록 약은 있으나 **레보도파 계열이 0개**면 토글은 노출하되 "현재 등록한 약은 약효추적 알림 대상이 아니에요"(§3-A) 안내.
- 약효 추적 알림 카드 상단에 디스클레이머 1줄 상시 노출:
  > "이 시간은 기본 추천이에요. 주치의와 상의해 조정하세요."
- 추천 메타가 있으면 "[등록한 약 기준 추천 다시 적용]" 보조 버튼 제공(선택, §3-C). 누르면 재계산 → "추천을 새로 적용할까요?" 확인 후 사용자가 선택(강제 금지). **사용자가 직접 수정한 값은 동의 없이 덮지 않음**(사용자 수정 플래그 §8).
- 기존 추가/수정/삭제 UI는 그대로 유지(수정 금지 영역 — 요청한 것만 변경).
- (선택) 카드 내 "📄 식약처 약 정보 직접 보기" 버튼으로 등록 레보도파 약의 식약처 원문 링크 제공(§4-A).

### 7.4 디스클레이머 문구 (공통)
- "이 시간은 기본 추천이에요. 반드시 주치의와 상의해 조정하세요."
- 모든 노출 텍스트 18sp 이상, 버튼 56dp 이상, 아이콘+텍스트 동반.

---

### 7.5 슬롯 단위 안내 — DoseSlotSetList(복용 시각별 약효추적 박스2) (오너 확정 — 2026-06-25, AGENT_06 구현 완료)

> 약효추적 시간 설정 화면의 **복용 시각별 세트카드(DoseSlotSetList) 박스2(약효 추적 알림)** 에서, 그 시각에 등록된 약 기준으로 **권장 시점을 글로만 안내**한다. §7.1 온보딩 카드·§7.3 설정 카드와 별개의 "슬롯 단위" 안내 레이어다.

> **문구·디자인 전면 재작업 갱신 (2026-06-25 2차, AGENT_06)**: 오너가 1차 디자인을 강하게 질책 → 문구 구조·시각 위계·면책 문구를 아래로 전면 교체. **"이 시간대 약:" 헤더 삭제**(슬롯에 약이 이미 정해져 군더더기). **메인 안내를 "{약명}는(은) {시점}에 몸 상태를 확인하는 걸 추천해요." 단일 문장**으로. **"추천근거:" 줄 신설**(약효 PK 데이터→일반어). **면책 간결화**. **"추천" 단어 허용**(오너가 직접 "추천해요/추천근거" 사용 지시 — 기존 §7-X.4 "추천 단어 금지" 룰을 슬롯 안내 한정으로 뒤집음).

> **추천근거=출처 표기 + 미니멀 재디자인 갱신 (2026-06-25 3차, AGENT_06)**: 오너가 2차를 다시 질책 → 아래 4가지 전면 교체. **① 추천근거 = "약효 설명 문장"이 아니라 "출처 한 줄"**: rationale(약효 구구절절 설명)을 메인/근거에서 전부 빼고, `추천근거: {출처}` 한 줄로. 출처 문구는 자체 구축 파킨슨약 약동학 시드(prescription_medication_spec.md·medication_pk_profile)이므로 **식약처 등 기관 사칭 금지**, 정직하게 "약효 작용시간 자료" 수준. 코드 단일 출처는 `recommendUtils.SOURCE_LABEL`(현재 `약효 작용시간(약동학) 자료`). **② 그림자/elevation 제거**(AI가 한 티라고 질책). **③ 굵기 강조 제거**(약명·시점 weight 800 → 일반 weight). **④ 색강조 제거**(좌측 컬러바·진한초록 약명/시점·초록 "추천근거" 라벨·연초록 배경 전부 제거 → 차분한 단색, 위계는 글자 크기·여백으로만). 이모지 남발 제거(메인 줄 ⓘ/💬/💊 제거, 등록 버튼 텍스트만). `rationale` 필드는 `@deprecated` UI 미사용으로 강등(데이터는 참고용 잔존).

#### 오너 확정 결정 (이대로 구현)
1. **표시 = 안내 문구만.** 권장 시점을 글로 안내만 하고, `track_intervals` 체크는 사용자가 직접. **자동 적용/원탭 "맞추기" 버튼 없음**(§3-C 비강제 연장선). 안내 추가가 슬롯 값(track_intervals)을 바꾸지 않는다.
2. **대상 = 레보도파 계열 위주(§3-A).** 시네메트·마도파·스타레보 등 레보도파 계열은 그 약의 권장 시점(`CLASS_RECOMMENDATION` offsets union — IR 30·60·120 / CR 60·180 / 복합제 30·90·180)을 안내. 비레보도파(도파민작용제·패치 등)·매칭 실패 약은 시점 단정 안내 금지 → "기본 시간으로 맞춰뒀어요"류 안심 문구.
3. **약 없는 슬롯**: "약을 등록하시면 약효추적 시점을 알려드려요." + "💊 약 등록하러 가기" 버튼(56dp+, `MedicationManage` `mode:'meds'` 이동). 이 분기는 약효 안내가 없으므로 **면책 줄 생략**.
4. **의료 면책 한 줄**(가장 작고 연한 맨 아래 별행): **"확정 처방은 아니니 의사와 상의하세요."**(1차 "확정 처방이 아니에요. 주치의와 상의해 조정하세요."보다 짧게, 오너 표현 반영). 분기①②에만 노출.

#### 3분기 UI 문구 (3차 — 구현된 실제 텍스트)
- **① 레보도파 약 있음** (3줄 위계, 강조 없는 단색):
  - 메인: `{약명}는(은) {시점들}에 몸 상태를 확인하는 걸 추천해요.` — **이모지·색·굵기 강조 없음**(전부 기본 텍스트색·일반 weight). 시점 여러 개는 자연 나열("30분 후와 2시간 후" / "30분 후, 1시간 후와 2시간 후"). 0분은 "복용 직후". 주격 조사(는/은)는 약명 끝글자 받침으로 자동.
    - 예: `마도파는 30분 후, 1시간 후와 2시간 후에 몸 상태를 확인하는 걸 추천해요.`
  - 추천근거 = **출처 한 줄**: `추천근거: {SOURCE_LABEL}` — 약효 설명 아님. 흐린 단색(textSub), 라벨 색강조 없음.
    - 현재 출처 문구(코드 기본 = 후보 A): `추천근거: 약효 작용시간(약동학) 자료`
    - 출처 문구 후보(오너 선택): **A** `약효 작용시간(약동학) 자료` / **B** `약품의 일반적인 약효 시간 정보`. 변경 시 `recommendUtils.SOURCE_LABEL` 한 줄만 교체.
  - 면책 별행: `확정 처방은 아니니 의사와 상의하세요.`
- **② 약 있으나 비레보도파/매칭 실패**: `기본 시간으로 맞춰뒀어요. 그대로 두셔도 괜찮아요.`(이모지 없음) + 면책 별행(시점 단정·출처 줄 없음).
- **③ 약 없음**: `약을 등록하시면 약효추적 시점을 알려드려요.`(이모지 없음) + `[약 등록하러 가기]`(56dp+). 면책 없음.

#### 디자인 위계 (3차 — 미니멀, AI티 금지)
- **카드(`recBox`)**: **그림자/elevation 0**, 좌측 컬러바 제거, 진한 색강조 제거. 아주 연한 중립톤 배경(`#F7F8F9`), `borderRadius 12`, padding 16. 경고색·경고아이콘 없음.
- **메인 안내(`recMain`)**: `fontSize 18 / Colors.text / lineHeight 27` — **weight·색강조 없음**(약명·시점 강조 제거). 아이콘 없음(행 단일 Text, 자연 wrap).
- **추천근거=출처(`recSource`)**: `fontSize 14 / Colors.textSub / lineHeight 21 / marginTop 12` — 라벨 색강조 없는 단색 한 줄.
- **면책(`recDisclaimer`)**: `fontSize 13 / Colors.textHint / marginTop 12`, 맨 아래 별행(가장 작고 연함).
- **약 등록 버튼(`recRegisterBtn`)**(분기③): `minHeight 56 / Colors.primary / 18sp 700 흰글씨`(액션 버튼이라 primary 유지).
- 제거된 스타일: `recMainRow`/`recMainIcon`/`recEmph`/`recBodyFlex`/`recReason`/`recReasonLabel`(굵기·아이콘·색강조 잔재).

#### 데이터·구현 (§12 영향 파일 추가분)
- `src/constants/medEffectProfiles.ts`: `TrackingRecommendation.rationale?`는 **`@deprecated` UI 미사용**(약효 설명 → 출처 표기 전환). 데이터(rationale 문장)는 참고용으로만 잔존, 화면 노출 없음.
- `src/hooks/useSlotMedications.ts` (신규): `medication_dose_slots ⨯ medications` 조인 → `slotId → [{name, ediCode, itemSeq}]` 맵. 읽기 전용·realtime 반영. 비활성(중단) 약 제외.
- `src/utils/recommendUtils.ts`: `recommendForSlotMeds(meds)` 헬퍼 — 반환은 `{ hasMeds, levodopaNames[], offsets[], **source** }`. `source` = 레보도파 약 있을 때만 `SOURCE_LABEL`(출처 한 줄), 없으면 `''`. **rationale 문장 수집 로직 제거**. `SOURCE_LABEL` 상수 신설(출처 단일 출처). 판정·union 은 단일 출처 규칙.
- `src/components/settings/DoseSlotSetList.tsx`: 박스2 체크줄(`qHead`/`checkGrid`) 위 3분기 안내 렌더. 메인 문장 조립 헬퍼(`buildMainSentence`/`joinNames`/`joinOffsets`/`topicParticle`/`offsetPhrase`) 유지. 체크줄 **자동 체크 안 함**. 기존 토글·체크줄 로직 무수정.

#### 금지 준수
- **"추천" 단어 = 오너 명시 허용**(이 슬롯 안내 한정). 경고아이콘(⚠️❗🚨) 금지. **그림자·다색 강조·굵기 강조 금지**(3차 핵심). 출처 사칭 금지(기관명 X, "약효 작용시간 자료" 수준). 색 단독 상태표시 금지. 신규 헤더/컴포넌트 재설계 금지(기존 박스2 내 안내 블록만 교체). 18sp+(면책·출처 제외)/56dp+/일반어/행잉인덴트 준수. paddingBottom 하드코딩 없음.

#### 서버 무수정
- `queue-effect-tracking`/`get_meds_at_time`/`process-notification-queue`/`dose_slots` patch 경로·`track_intervals` 값 — **전부 무수정**. 본 작업은 "안내"만 추가(읽기 전용 조회 + 표시).

#### 출처 검증 완료 + 출처 줄 복구 갱신 (2026-06-25 4차, AGENT_06)

3차에서 출처 정확성 재검증을 위해 임시로 출처 줄을 숨겼다(`false && !!rec.source`). 18종 약동학을 **미국 FDA 제품 허가정보(제품 라벨) + 제조사 제품정보(SmPC) + 약학정보원**으로 교차 검증 완료 → 출처 줄 복구·문구 확정.

- **약효시간 근거 = 미국 FDA 라벨 / 제조사 SmPC.** 레보도파 계열(시네메트·시네메트CR·마도파·마도파HBS·스타레보·퍼킨)의 약효 발현·지속 시점 수치가 1차 자료와 부합 → 추적 안내 유지.
- **식약처 단독 표기 금지(부정확·사칭).** 한국 식약처 원문 PK 는 직접 확보하지 못함 → 출처에 "식약처 기준"이라고 적으면 사칭이 된다(§4-A·§9-3 출처 사칭 금지 연장선). 검증된 1차 근거만 표기.
- **출처 문구 = `미국 FDA·제조사 의약품 정보`** (`recommendUtils.SOURCE_LABEL`). 60대 일반어, 전문어 "약동학" 제거. 기존 후보 A(`약효 작용시간(약동학) 자료`)·B(`약품의 일반적인 약효 시간 정보`)는 폐기.
- **UI 출처 줄 복구.** `DoseSlotSetList.tsx` 분기① 출처 줄 가드를 `false && !!rec.source` → `!!rec.source` 로 되돌려 렌더 복구. 렌더 라벨 후보 2종을 목업으로 비교(오너 선택):
  - **A**: `추천근거: 미국 FDA·제조사 의약품 정보`
  - **B(코드 기본 채택)**: `약효 시간 출처: 미국 FDA·제조사 의약품 정보` — 출처 범위가 "약효 시간"임이 더 명확해 기본값으로 적용. 변경 시 라벨 텍스트만 교체.
- **추적 시점은 그 약효시간 기반 자체 안내(오인 금지).** 출처는 "약효 발현·지속 시간"의 근거이고, "복용 후 30분·2시간 확인"이라는 추적 시점 자체를 FDA 가 권고한 것은 아니다. 면책 줄을 출처 범위 오인 방지로 보강: **`약효 시간은 위 출처 기준이며, 확인 시점은 참고 안내예요. 확정 처방은 아니니 의사와 상의하세요.`**
- 디자인은 3차 미니멀 유지(그림자 0·굵기/색강조 0·`recSource` = textSub 작게·차분한 보조 톤). 서버·`track_intervals`·시점 데이터 전부 무수정(출처 표기·복구만).

---

### 7-X Phase 2 온보딩 추천 카드 확정 UX (UX 에이전트 토론 결과 + 오너 확정)

> 본 절은 §7.1(NotificationSetupScreen)·§9·§13-2 옵션1(Phase 2)의 **확정 UX 규격**이다. 신규 컴포넌트 추가 없이 기존 `optionCard`/`warningCard`/`PrimaryButton`을 재사용하며, 헤더 `backBtn`·`BottomArea` 구조는 수정하지 않는다(요청 외 재설계 금지). 카피·문안은 아래 기재 문장을 그대로 채택한다.

#### 7-X.0 도출 경위 — UX 에이전트 병렬 토론
- **디자인 스펙 에이전트 vs 사용자 심리 에이전트**를 병렬로 토론시켜 도출.
- 파킨슨 환자 특성(질병 불안 + 손떨림 + 온보딩 피로)상 **심리 관점 권고를 다수 채택**. 디자인 스펙 권고는 60대 UI 기준(18sp/56dp/아이콘+텍스트) 범위에서 수용.

#### 7-X.1 오너 확정 3건 (전부 반영)
1. **토글 밀도 — 추천 시점 전부 펼침**: 대표 2개 + "더보기" 접기 방식이 **아님**. 오너가 추천 시점 **전부 노출**을 선택. 단, 손떨림 안전책(행 전체 탭 72dp+, 토글 간격 16~20dp, 색+상태텍스트 동반)은 그대로 유지한다.
2. **식약처 원문 링크 — 온보딩엔 약하게**: 온보딩 화면에서는 약한 보조 링크로만 두고, 누를 때 **"인터넷 창이 열려요 / ◀로 돌아오세요"** 고지를 동반한다. **상세·제대로 된 식약처 원문 진입(약 상세 URL 직접 오픈)은 설정·약 관리 화면(Phase 3~4, §7.2-bis·§7.3·§4-A)** 에 배치한다. 온보딩에서 메인 동선을 식약처로 빼지 않는다.
3. **디스클레이머 — 안심·권한부여 톤 + 법적 최소문구만 별행 유지**: 부정문("확정 처방이 아니에요" 류)을 1순위로 노출하지 않는다. 긍정·돌봄 프레임을 본문으로 한다. 단 의료 안전상 "확정 처방 아님 / 주치의 상의" **취지의 법적 최소문구는 작은 별행으로 반드시 잔존**시킨다(삭제 금지, 다만 톤·위치는 보조로).

#### 7-X.2 채택된 심리 권고 (구현 필수)
- 행 전체가 탭 영역(터치 타깃 **72dp 이상**) — 작은 토글 스위치만 노리지 않게.
- 토글 항목 간 세로 간격 **16~20dp**(손떨림 오탭 방지).
- ON/OFF를 **색 + 상태 텍스트로 동반 표기**: ON = "받는 중", OFF = "안 받음"(색만으로 상태 전달 금지).
- 다음 단계 진입 **직전 요약 확인 1스텝**: "이렇게 받으실 거예요: …  맞나요?" 형태로 선택 시점 요약을 보여주고 확인받는다(되돌릴 수 있다는 통제감 부여).
- 선택 버튼 **2개를 동등한 무게**로(primary 강조 / 회색 약화 같은 비대칭 금지) — 어느 쪽도 죄책감/유도 없이 동등.
- UI 카피에서 **"추천"이라는 단어 회피** → "미리 맞춰둔 시간" 등 중립·돌봄 어휘 사용.
- **경고 아이콘(⚠️ ❗ 🚨) 사용 금지** → ⓘ 또는 💬 등 부드러운 정보 아이콘.
- **손실·일탈 프레임 버튼 금지**("알림 없이 계속" 류) → 중립 어휘로 대체("나중에 정할게요" 등 일탈 낙인 없는 표현).
- 비레보도파만 / 약 없음 상태에서 **치료 불안 방지 안심 문구 동반**: "약은 평소대로 잘 챙기시면 돼요"(추적 알림이 없다고 약을 잘못 먹고 있다는 불안을 차단).

#### 7-X.3 확정 카피(권장 문안 — 그대로 채택)

**A. 상단 안내(긍정·돌봄 프레임, warningCard 스타일 재사용 — 단 경고색이 아닌 안내 톤)**
> "💊 등록하신 약에 맞춰 미리 시간을 맞춰뒀어요.\n편하게 받으시면 되고, 언제든 바꾸실 수 있어요."

작은 별행(법적 최소문구 — 보조 크기, 삭제 금지):
> "ⓘ 확정 처방은 아니에요. 주치의와 상의해 조정하세요."

**B. 토글 행(추천 시점 전부 펼침, 행 전체 탭)**
- 라벨 예: "복용 30분 뒤 확인", "복용 1시간 뒤 확인", "복용 2시간 뒤 확인"
- 상태 텍스트: ON = "받는 중", OFF = "안 받음"

**C. 다음 단계 직전 요약 확인 1스텝**
> "이렇게 받으실 거예요:\n• 복용 30분 뒤\n• 복용 2시간 뒤\n맞나요?"
- 버튼 2개 동등 무게: [네, 이대로 할게요] / [다시 고를게요]

**D. 식약처 원문 약한 보조 링크(온보딩 한정)**
> "💬 이 약의 식약처 정보 보기"

탭 시 고지(중립·안심):
> "인터넷 창이 열려요. 보고 나서 ◀(뒤로)로 돌아오시면 돼요."

**E. 비레보도파만 등록 / 추적 비대상 안심 카피**
> "이 약은 약효추적 알림 대상이 아니에요.\n약은 평소대로 잘 챙기시면 돼요. 알림은 안 와도 괜찮아요."

**F. 약 없음 차단(§3-B-B) 안심 카피**
> "약효추적 알림은 등록한 약에 맞춰 보내드려요.\n먼저 약을 등록하시면 자동으로 맞춰드릴게요."
- 버튼: [💊 약 등록하러 가기] (56dp+)

**G. 매칭 실패 fallback**
> "기본 시간(복용 30분·2시간 뒤)으로 맞춰뒀어요.\n나중에 약 관리에서 더 정확히 맞출 수 있어요."

#### 7-X.4 절대 금지 표현/패턴 블랙리스트 (§9 연동 — 명문화)
| 분류 | 금지 | 사유 / 대체 |
|---|---|---|
| 출처 사칭 | "식약처 권장 시간", "식약처가 추천" | §9-3 출처 사칭 금지. 대체: "미리 맞춰둔 시간" |
| 단어 | UI 본문의 "추천"(노출 카피) | 심리 권고. 대체: "미리 맞춰둔 시간" |
| 아이콘 | ⚠️ ❗ 🚨 (경고 아이콘) | 질병 불안 자극. 대체: ⓘ 💬 |
| 손실 프레임 버튼 | "알림 없이 계속", "건너뛰기(부정 강조)", "그냥 진행" | 일탈·죄책감 프레임. 대체: "나중에 정할게요" |
| 버튼 비대칭 | 한쪽 primary 강조 + 한쪽 회색 약화 | 선택 유도. 두 선택지 동등 무게 |
| 부정문 1순위 | "확정 처방이 아니에요"를 본문 1순위로 | 불안 자극. 본문은 긍정, 법적 최소문구는 작은 별행 보조로만 |
| 색 단독 상태 | 토글 ON/OFF를 색으로만 표시 | 고대비·접근성. 색 + 상태텍스트("받는 중/안 받음") 필수 |
| 작은 링크 | 작은 텍스트 식약처 링크를 메인 동선에 | 60대 UI·온보딩 약하게 원칙. 보조 링크 + 이탈 고지 |
| 구조 변경 | 헤더 `backBtn`·`BottomArea` 재설계, 신규 컴포넌트 추가 | 요청 외 재설계 금지. 기존 `optionCard`/`warningCard`/`PrimaryButton` 재사용 |

#### 7-X.5 4개 상태별 카드 구성 (기존 컴포넌트 재사용)
| 상태 | 카드 구성 | 재사용 컴포넌트 |
|---|---|---|
| ① 레보도파 정상(추천 있음) | 상단 안내(7-X.3 A) + 추천 시점 **전부 펼친** 토글 행(B) + 약한 식약처 보조 링크(D) + 다음 직전 요약확인(C) | `warningCard`(안내 톤), `optionCard`(토글 행), `PrimaryButton`×2 동등 |
| ② 비레보도파만 | 추적 비대상 + 안심 카피(7-X.3 E) — 토글 없음, 약 정보·식약처 링크는 보조로 제공 | `warningCard`(안심 톤) |
| ③ 약 없음 | 차단 안내 + 안심 카피(F) + "💊 약 등록하러 가기"(56dp+) | `warningCard`, `PrimaryButton` |
| ④ 매칭 실패 fallback | 기존 검증 기본값(30분·2시간) 유지 + 안내 카피(G) — 토글은 기본값으로 펼침 | `warningCard`, `optionCard`, `PrimaryButton` |

- 4개 상태 모두 신규 컴포넌트 추가 없이 기존 `optionCard`/`warningCard`/`PrimaryButton` 재사용. 헤더 `backBtn`·`BottomArea` 구조는 수정하지 않는다(요청 외 재설계 금지).

#### 7-X.6 §13-2 옵션1(Phase 2) 연동 재확인
- `NotificationSetupScreen`이 AsyncStorage `onboarding_medications`를 읽어 **Phase 1 유틸 `buildRecommendedMedNotifs`** 로 추천 `MedNotif[]` 생성 → `handleConfirm`에서 `useSettings().setMedNotifs(추천 MedNotif[])` **직접 호출** + `med_notif_recommendation_meta` 저장.
- `FamilyInviteScreen.tsx:204-216` **손실성 하드코딩 브리지 교체**(after30/after2h만 인식 → 추천 `MedNotif[]` 무손실 통과).
- 서버 푸시 경로(`queue-effect-tracking`·`process-notification-queue`·`effect_tracking_queue` 스키마·`useMedication.ts` 큐 호출부)는 **절대 무수정**.
- 본 7-X UX 규격은 위 데이터 흐름 위에 얹는 표시·확인 레이어이며, 데이터 경로·서버 경로를 바꾸지 않는다.

---

## 8. 데이터 모델 / DB 영향

| 대상 | 변경 | OTA 영향 |
|---|---|---|
| `medication_pk_profile` (원격 기존) | 변경 없음(읽기만). 필요 시 시드 데이터 보강(분류/`suggested_slots` 채움)은 SQL 마이그레이션으로 별도 | DB 변경은 OTA와 무관(서버측) |
| `medications` (원격 기존) | **`item_seq`(text, nullable) 컬럼 1개 추가**(§3-F). 약 등록 시 식약처 ITEM_SEQ 저장 → 식약처 원문 직접 링크용. Supabase 마이그레이션(서버측) | **DB 변경은 OTA와 무관(서버측)**. 앱 네이티브 무관 |
| `effect_tracking_queue` | **변경 없음** | - |
| `users.med_notif_prefs` (jsonb) | 스키마 변경 없음. 값만 추천으로 초기 채움 | OTA 가능 |
| AsyncStorage `med_notif_recommendation_meta` | 신규 키(클라 로컬) | OTA 가능 |
| AsyncStorage `med_notif_user_edited`(또는 메타 내 `userEdited` 플래그) | **신규 — 사용자 수정 여부 플래그**(§3-C) | OTA 가능 |
| `DrugInfo` 인터페이스 + 식약처 응답 파싱 | **`itemSeq?: string` 필드 추가**(ITEM_SEQ 파싱) — 식약처 원문 링크용 | OTA 가능(JS/TS) |
| Edge Functions (`queue-effect-tracking` 등) | **변경 없음** | - |
| 신규 상수 파일 `src/constants/medEffectProfiles.ts` | 신규(JS/TS만) | **OTA 가능** |

→ **DB 스키마 변경: `medications.item_seq`(text, nullable) 컬럼 1개 추가 필요(OTA 무관 — 서버측 Supabase 마이그레이션)**. (정정: 기존 "DB 스키마 변경 불필요" 서술은 ITEM_SEQ 등록 시점 저장 결정(§3-F)에 따라 무효. `medication_pk_profile`/`med_notif_prefs`는 그대로 재활용.) 큐레이션 테이블·플래그·ITEM_SEQ 파싱은 전부 앱 번들 내 TS 변경 → 순수 JS/TS 변경(OTA 가능). DB 컬럼 추가는 앱 재심사·OTA와 무관한 서버측 작업.

### 8.1 사용자 수정 여부 플래그 (§3-C 절대 원칙 — 신규)

추천이 사용자가 직접 수정한 값을 덮어쓰지 않도록 **명시적 플래그**를 둔다(`med_notif_prefs` DB 존재 여부만으로는 "추천 적용분"과 "사용자 수정분"을 구분 불가).

```ts
// AsyncStorage 'med_notif_recommendation_meta' 확장
type MedNotifRecommendationMeta = {
  /** 추천 출처 분류 (재추천 판단·UI 안내용) */
  recommendedFromClasses: DrugClass[];
  /** 추천 산출에 쓰인 레보도파 약 식별 키(약명/EDI) + 용량 — 약/용량 변경 감지(§3-C) */
  sourceMedSignature: string;     // 예: "시네메트정@250mg|스타레보@..." 정렬·해시
  /** 사용자가 약효추적 시점을 한 번이라도 직접 수정했는가 (§3-C 핵심 플래그) */
  userEdited: boolean;
  /** 마지막 추천 적용 시각(ISO) — 사용자가 명시적으로 '추천 적용' 누른 시점 */
  lastAppliedAt?: string;
};
```

규칙:
- 사용자가 약효추적 시점을 추가/변경/삭제하면 `userEdited = true`로 잠근다.
- 약/용량 변경(§3-C) 감지는 `sourceMedSignature` 비교로 한다(약물동태 프로필 변경: 분류 변경 / IR↔CR / 레보도파 추가·제거 / 용량 변경).
- 재추천 시: `userEdited === true`이면 **자동 적용 절대 금지**. "추천을 새로 적용할까요?" 제안만 하고 사용자가 [새로 적용] 선택 시에만 덮어쓴다(이때 다시 `userEdited` 초기화 여부는 사용자가 적용을 선택한 행위 자체로 새 기준 확정).
- 신규 가입(§3-B-A): `userEdited === false` 상태라도 자동 강제 적용 금지 — 어디까지나 "표시"이며 사용자가 명시적으로 적용 버튼을 눌러야 반영.

---

## 9. 의료 안전 · 면책 처리

1. 추천은 "기본값"이며 강제 아님 — 모든 추적 시점은 추가/변경/삭제 가능. **자동 강제 적용 금지, 표시만**(§3-B-A, §3-C).
2. 모든 추천 노출 지점에 "주치의와 상의해 조정하세요" 디스클레이머 상시 표시.
3. **출처 사칭 금지**: "식약처 권장 시간" 표기 절대 금지. 추천 수치는 앱 내부 큐레이션 + 파킨슨병 일반 진료 권고 출처로만 표기하고, 식약처 원문은 ITEM_SEQ 기반 직접 링크로만 안내(§4-A).
4. 큐레이션 수치는 임상 레퍼런스 기반 기본 추천임을 코드 주석·문서에 명시. 의학적 확정값 아님.

### 9-A. 의학 자문(임상 자문) 미진행 결정 + 책임 경계 4종 (오너 확정 — 2026-05-18)

- **결정**: 본 기능에 대해 **의학 자문(임상 자문)은 진행하지 않는다.**
- **사유(오너 판단)**: 의학 자문이 들어가면 일이 과도하게 커진다. 따라서 별도 임상 자문 절차 없이, 큐레이션 분 단위 추천값을 **"일반 참고 추천"으로만** 제시하고 아래 4가지 책임 경계로 갈음한다.
- **책임 경계 4종 (이것으로 임상 자문을 갈음한다)**:
  1. **일반 참고 추천 명시**: 추천값은 확정 처방이 아니라 일반 참고 추천임을 추천 카드·온보딩·설정 등 모든 노출 지점 UI에 명시한다(예: "이 시간은 일반 참고 추천이에요. 확정 처방이 아니에요").
  2. **주치의 상의 디스클레이머 상시 노출**: "환자분 상태에 따라 다를 수 있으니 주치의와 상의하세요" 문구를 모든 추천 노출 지점에 상시 표시(§7.4 공통 디스클레이머와 일치).
  3. **식약처 원문 직접 링크로 출처 비사칭**: "📄 식약처 약 정보 직접 보기" 버튼으로 의약품안전나라 원문(저장된 `item_seq` 기반)을 사용자가 직접 확인하게 한다. 앱이 추천 수치의 출처를 식약처인 양 사칭하지 않는다(§4-A 출처 정직성과 일치).
  4. **비강제 추천**: 추천은 강제가 아니며 사용자가 최종 선택·수정한다(토글/"추천 시간으로 설정" 명시 동작 필요, §3-C·§3-B-A). 사용자 수정값은 동의 없이 덮지 않는다(§8.1 `userEdited`).
- 본 4종 처리로 §13-7(큐레이션 수치 임상 검증 미완료)을 종결 처리한다. "추후 임상 검토 권장"은 더 이상 미결 사항이 아니라 오너 결정으로 갈음 완료된 종결 상태다.
5. **레보도파 계열만 추적 대상**(§3-A). 비레보도파(도파민작용제/MAO-B/COMT/항콜린제/아만타딘/로티고틴 패치)는 추적 비대상 → 약효추적 알림 미생성 + 사유 안내(잘못된 알림으로 인한 혼선 방지). 단 약 정보·식약처 링크는 전 약 제공.
6. **약 종속 원칙**(§3-B-B): 등록 약 0개면 약효추적 토글 진입 차단 + 약 등록 유도.
7. **사용자 수정값 보존**(§3-C, §8.1): 사용자가 직접 수정한 값은 동의 없이 자동으로 덮지 않음(`userEdited` 플래그). 재추천은 항상 제안 후 사용자 선택.
8. 매칭 실패 시 기존 검증된 기본값(30분·2시간) 유지 — 추측성 추천으로 인한 위해 방지.
9. 추천 적용 여부는 사용자 동작(토글/"추천 시간으로 설정" 버튼)으로 명시적 확인(온보딩도 표시·기본 ON이되 사용자가 끄거나 바꿀 수 있고 디스클레이머 상시 노출).
10. **금지 표현/패턴 블랙리스트(§7-X.4)**: 출처 사칭("식약처 권장/추천"), UI 본문의 "추천" 단어, 경고 아이콘(⚠️❗🚨), 손실·일탈 프레임 버튼("알림 없이 계속"), 버튼 비대칭(한쪽 primary/한쪽 회색), 부정문 1순위 노출, 토글 색 단독 상태표시, 메인 동선의 작은 식약처 링크, 헤더/BottomArea 재설계·신규 컴포넌트 추가 — 모두 절대 금지. 상세 표·대체안은 §7-X.4 참조.
11. **온보딩 디스클레이머 톤(§7-X.1-3)**: 본문은 안심·권한부여(긍정·돌봄) 프레임으로 하되, "확정 처방 아님 / 주치의 상의" 취지의 법적 최소문구는 작은 별행으로 반드시 잔존(삭제 금지, 보조 위치 허용).

---

## 10. OTA 배포 가능 여부 검토

- 신규 파일: TS 상수(`medEffectProfiles.ts`), 추천 유틸(`medUtils.ts` 또는 신규 `recommendUtils.ts`) — **순수 JS/TS**.
- 화면 수정: `NotificationSetupScreen.tsx`, `MedicationManageScreen.tsx`, `SettingsScreen.tsx`, `SettingsContext.tsx` — JS/TS 로직·UI.
- 네이티브 모듈 추가 없음, `app.json` permissions/plugins 변경 없음, SDK 업그레이드 없음.
- → **전부 OTA 배포 가능**. (`medication_pk_profile` 시드 보강이 필요하면 Supabase SQL로 별도 적용 — 앱 재심사 불필요)
- 배포: CLAUDE.md 원칙대로 맥북 로컬 `npx eas update --branch production --message "..." --non-interactive` 수동 실행.

---

## 11. 단계별 구현 계획

> 본 프로젝트는 오케스트레이터 위임 원칙(CLAUDE.md). 실제 구현 시 AGENT_01(온보딩)/AGENT_08(메뉴·설정)/AGENT_06(알림)에 분배하고 AGENT_11~14 검수를 거친다.

### Phase 1 — 큐레이션 데이터 · 추천 엔진 (담당: AGENT_06 알림 / AGENT_08)
1. `src/constants/medEffectProfiles.ts` 신규 작성 (4.2 데이터 구조).
2. 추천 함수 작성 (`src/utils/recommendUtils.ts` 신규 또는 `medUtils.ts` 확장):
   - `resolveTrackingRecommendation(medName, mfdsInfo?, ediCode?): TrackingRecommendation | null`
   - `buildRecommendedMedNotifs(meds): { notifs: MedNotif[]; classes: DrugClass[] } | null` (다약 union)
   - `medication_pk_profile` 조회 헬퍼(EDI/품명) — MedicationManageScreen 기존 로직 추출·공용화.
3. 단위 검증: 시네메트→[30,60,120], 스타레보→[30,90,180], 뉴프로→비활성, 아질렉트→OFF 등.

### Phase 2 — 온보딩 연동 (담당: AGENT_01 온보딩) — §13-2 옵션 1 채택분
> **§13-2 매핑**: 옵션 1(추천을 medNotifs에 직접 반영 + 손실성 브리지 교체) ↔ **Phase 2**에서 처리.
4. `NotificationSetupScreen.tsx`: AsyncStorage `onboarding_medications` 읽어 추천 계산 → 동적 옵션·개별 토글·디스클레이머·식약처 원문 링크·분류 note 렌더. 확정 시 `handleConfirm`에서 `useSettings().setMedNotifs(추천 MedNotif[])` 직접 호출 + `med_notif_recommendation_meta` 저장.
5. `FamilyInviteScreen.tsx:204-216` 손실성 하드코딩 브리지(after30/after2h만 인식 → `settings_med_notifs` 저장) **제거/교체** — 추천 `MedNotif[]` 무손실 통과로 변경.
6. 추천 없음/전부 비활성 케이스 fallback(기존 `DEFAULT_MED_NOTIFS` 30분·2시간) 처리.
7. 서버 푸시 경로(`queue-effect-tracking`·`process-notification-queue`·`effect_tracking_queue`·`useMedication.ts` 큐 호출부) **절대 무수정** 확인.

### Phase 3 — 약 관리 연동 (담당: AGENT_08 메뉴/설정)
6. `MedicationManageScreen.tsx`: 기존 PK tip Alert을 "추천 시간으로 설정" 선택지 포함 다이얼로그로 확장. 선택 시에만 `setMedNotifs` 갱신.
7. `SettingsScreen.tsx`: 약효 추적 알림 카드 상단 디스클레이머 1줄 + (선택)재추천 버튼. 기존 추가/수정/삭제 UI 불변.

### Phase 4 — Settings/Context 정합성 (담당: AGENT_06) — §13-2 옵션 3 잔여 분리분
> **§13-2 매핑**: 옵션 3 잔여(사용자 수정값 보존·우선순위 정합성) ↔ **Phase 4**로 분리 처리(§13-6 연동).
8. `SettingsContext.tsx:144-207`: 로드 시 추천 초기 채움 vs `userEdited` 사용자 수정값 우선순위 로직(사용자가 수정한 적 없을 때만 추천 기본값 적용) — `med_notif_prefs` DB 존재 여부 + `med_notif_recommendation_meta`(`userEdited`/`sourceMedSignature`) 비교로 판단.

### Phase 4-bis — ITEM_SEQ 파싱·저장 + DB 컬럼 (담당: AGENT_06 / Supabase SQL)
8-1. **Supabase 마이그레이션(필수)**: `medications` 테이블에 `item_seq text` 컬럼 추가(`*_add_medications_item_seq.sql`). 서버측, OTA·재심사 무관.
8-2. `MedicationRegisterScreen.tsx`·`MedicationManageScreen.tsx`: `DrugInfo`에 `itemSeq?: string` 추가, `searchMfdsInfo`/`grnHit` 파싱에 `itemSeq: item.ITEM_SEQ` 추가, 약 저장/수정 시 `medications.item_seq` 기록.
8-3. 추천 카드·상세 보기 "📄 식약처 약 정보 직접 보기": 저장된 `item_seq`로 `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq={item_seq}` 외부 브라우저 오픈(`Linking.openURL`). `item_seq` null이면 약명 통합검색 폴백 URL. WebView 사용 금지.

### Phase 5 — (선택) DB 시드 보강 (담당: AGENT_06, Supabase SQL)
9. `medication_pk_profile`에 큐레이션 분류와 일치하도록 `suggested_slots`/`drug_class` 결손분 보강 SQL 마이그레이션. (앱 재심사 불필요, 서버측)

### Phase 6 — 검수 (AGENT_11 디자인 → 12 코드 → 13 테스트 → 14 보안)
10. 60대 UI 기준(18sp/56dp/아이콘+텍스트), 디스클레이머 노출, 매칭 실패 회귀 없음, 서버 푸시 경로 무변경 확인.

### Phase 7 — OTA 배포
11. `npx eas update --branch production --message "약효추적 시간 추천" --non-interactive` 수동 실행.

---

## 12. 영향 받는 파일 목록

| 파일 | 역할 | 변경 내용 |
|---|---|---|
| `src/constants/medEffectProfiles.ts` | (신규) 큐레이션 상수 | 분류 정의·키워드·추천 오프셋 테이블 |
| `src/utils/recommendUtils.ts` | (신규) 추천 엔진 | `resolveTrackingRecommendation`, `buildRecommendedMedNotifs`, pk_profile 조회 헬퍼 |
| `src/screens/onboarding/NotificationSetupScreen.tsx` | 온보딩 약효추적 알림 설정 화면 | (§13-2 옵션 1·Phase 2) 하드코딩 after30/after2h 옵션 → `onboarding_medications` 기반 추천 동적 옵션·개별 토글·디스클레이머·식약처 원문 링크. `handleConfirm`에서 `useSettings().setMedNotifs(추천 MedNotif[])` 직접 호출 + `med_notif_recommendation_meta` 저장 |
| `src/screens/onboarding/FamilyInviteScreen.tsx` (204-216행) | 온보딩→설정 알림값 다리 코드 | **(§13-2 옵션 1·Phase 2) 손실성 하드코딩 브리지 제거/교체**: 현재 after30/after2h만 인식해 `AsyncStorage['settings_med_notifs']`에 변환·저장(60/90/180분 추천 통과 불가, DB 미반영) → 추천 `MedNotif[]` 무손실 통과로 변경 |
| `src/screens/menu/MedicationManageScreen.tsx` | 약 관리(추가/OCR/수정) | PK tip Alert → "추천 적용" 선택 다이얼로그 확장(기존 pk_profile 조회 재사용) |
| `src/screens/menu/SettingsScreen.tsx` | 설정·약효추적 알림 카드 | 디스클레이머 1줄 + (선택)재추천 버튼. 기존 추가/수정/삭제 UI 불변 |
| `src/context/SettingsContext.tsx` (144-207행) | medNotifs 전역 상태/저장 | (§13-2 옵션 3 잔여·Phase 4) 로드 시 추천 초기 채움 vs `userEdited` 사용자 수정값 우선순위 로직 |
| `src/screens/onboarding/MedicationRegisterScreen.tsx` | 온보딩 약 등록 | **ITEM_SEQ 파싱 + 저장 필요**: `DrugInfo`에 `itemSeq?: string` 추가 + `searchMfdsInfo`의 `return {}`에 `itemSeq: item.ITEM_SEQ` 추가(현재 미수신, 실응답에 항상 포함 검증 완료). 약 저장 시 `medications.item_seq`에 기록. `onboarding_medications` 저장 포맷에 분류/식약처 정보 포함 점검 |
| `src/screens/menu/MedicationManageScreen.tsx` | 약 관리 식약처 조회 | **ITEM_SEQ 파싱 + 저장 필요**: `DrugInfo`에 `itemSeq?: string` 추가 + `return {}`에 `itemSeq: grnHit?.ITEM_SEQ` 추가(현재 미수신). 약 저장/수정 시 `medications.item_seq` 기록 |
| `src/utils/medUtils.ts` | 시간 라벨 유틸 | (선택) 추천 유틸을 여기 둘 경우만 변경 |
| `supabase/migrations/*_add_medications_item_seq.sql` | **(신규 필수) `medications.item_seq` 컬럼 추가** | `ALTER TABLE medications ADD COLUMN item_seq text;` — 서버측, OTA·앱 재심사 무관 |
| `supabase/migrations/*_seed_pk_profile.sql` | (선택 신규) pk_profile 시드 보강 | 서버측, OTA 무관 |

**무변경(중요)**: `supabase/functions/queue-effect-tracking/index.ts`, `process-notification-queue`, `effect_tracking_queue` 스키마, `useMedication.ts`의 서버 큐 호출부 — 서버 푸시 경로는 손대지 않음.

---

## 13. 리스크 · 오픈 이슈

> **오픈이슈 상태 요약(2026-05-18 기준 — Phase 1·1-bis·2·3-4 구현 완료 + §13-6 종결 반영)**
> - ✅ **해결됨 (6건)**: §13-2(온보딩 medNotifs 분리 구조 — 옵션 1 채택(Phase 2) — NotificationSetupScreen이 추천을 직접 medNotifs에 반영 + FamilyInviteScreen 손실성 브리지 교체, **Phase 2 구현 완료**), §13-3(알림 개수 캡 — 시스템 캡 미적용·사용자 개별 선택), §13-6(**사용자 수정값 보존 판정 기준 — 오너 확정으로 종결**: 추천 적용 이후 사용자가 약효추적 알림을 시점 ON/OFF·시간 변경·추가·삭제 중 하나라도 하면 `userEdited=true`. 이후 재추천은 자동으로 절대 안 덮고, 비강제 제안 다이얼로그로만, 사용자가 '새 시간으로 맞출게요' 명시 선택 시에만 교체 — Phase 3-4 구현 완료), §13-7(큐레이션 수치 임상 검증 — 오너 결정: 의학 자문 미진행, 디스클레이머·주치의 상의·식약처 원문 링크·비강제 추천으로 갈음), §13-8(ITEM_SEQ 수신 검증 완료 — **Phase 1-bis에서 파싱 구현 완료**), §13-9(의약품안전나라 URL 확정)
> - ⚠️ **미해결(추적 필요) (4건)**: §13-1(pk_profile 로컬 마이그레이션 부재 — 잔존), §13-4(약명 키워드 매칭 정확도 — 2단 구조로 완화됐으나 신약/제네릭 미커버 잔존), §13-5(CR/IR 구분 난이도 — 키워드 매칭으로 완화됐으나 약명에 표기 없으면 IR 분류 위험 잔존), §13-10(약/용량 변경 감지 정확도 — `sourceMedSignature` 용량 포함 구현으로 완화됐으나 §13-5 한계 공유 잔존)
> - 구현 완료(이슈 아님): ITEM_SEQ 코드 파싱 추가 + `medications.item_seq` 컬럼 마이그레이션 — **Phase 1-bis에서 파싱 2화면 적용 + 원격 마이그레이션 적용 완료**(§3-F, §14)

1. **`medication_pk_profile` 로컬 마이그레이션 부재**: 테이블이 원격 Supabase에만 존재하고 `supabase/migrations/`에 정의가 없음. 시드/스키마 보강 시 원격 직접 적용 필요 → 마이그레이션 파일 동기화 권장(형상관리 리스크).
2. **온보딩 medNotifs 분리 구조 — ✅ 해결: 옵션 1 채택(Phase 2), 사용자 수정값 보존 Phase 4 분리(2026-05-18 오너 확정)**:

   **분석으로 밝혀진 사실(통념 정정)**: 온보딩→서버큐는 완전 단절이 **아님**. `FamilyInviteScreen.tsx:204-216`이 다리 역할로 온보딩 알림 설정을 `AsyncStorage['settings_med_notifs']`에 변환·저장하고 있어, medNotifs에 추천값이 실리면 서버 푸시 경로(`queue-effect-tracking` → `effect_tracking_queue` → `process-notification-queue`)까지 **무수정으로 자동 도달**한다.

   **진짜 문제 3가지**: ① 온보딩 알림 화면(`NotificationSetupScreen`)이 약과 분리된 하드코딩 after30/after2h 2옵션만 다룸 ② 다리 코드(`FamilyInviteScreen.tsx:204-216`)가 손실성 — after30/after2h만 인식하여 60/90/180분 등 추천값이 통과 못 함 ③ 다리가 `med_notif_prefs` DB에는 안 쓰고 `AsyncStorage`만 갱신 → DB 우선순위 역전 위험.

   **확정 통합안 = 옵션 1(Phase 2)**:
   - `NotificationSetupScreen`이 `onboarding_medications`를 읽어 추천 계산 → 추천 시점을 동적 표시 + 개별 토글 + 디스클레이머 + 식약처 원문 링크 제공 → `handleConfirm`에서 `useSettings().setMedNotifs(추천 MedNotif[])` 를 **직접 호출**.
   - `FamilyInviteScreen.tsx:204-216` 손실성 하드코딩 브리지 **제거/교체**(추천 `MedNotif[]` 무손실 통과).
   - 서버 푸시 경로(`queue-effect-tracking/index.ts`, `process-notification-queue/index.ts`, `effect_tracking_queue` 스키마, `useMedication.ts` 큐 호출부)는 **절대 무수정**.
   - 추천 매칭 실패 시 기존 `DEFAULT_MED_NOTIFS`(30/120) fallback 유지(회귀 방지).

   **Phase 4로 분리(옵션 3 잔여)**: `SettingsContext.tsx:144-207` 로드 시 "추천 초기 채움 vs `userEdited` 사용자 수정값 우선순위" 정합성 + `med_notif_recommendation_meta`(`userEdited`/`sourceMedSignature`)는 Phase 4에서 처리(§13-6과 연동, 추적 지속).
3. **다약 union 정책 / 알림 개수 캡 — ✅ 해결됨(2026-05-18 오너 확정)**: 시스템 인위적 상한 미적용. 추천 시점을 제시하되 **각 시점을 개별 토글로 켜고/끌 수 있는 UI** 제공, 사용자가 원하는 만큼 직접 선택(§3-E). "캡"은 시스템 강제가 아닌 사용자 선택의 결과. **미해결 목록에서 제거**.
4. **약명 키워드 매칭 정확도 — ⚠️ 구현으로 완화·잔존**: 동일 성분 다양한 브랜드/제네릭명 → 키워드 누락 가능. Phase 1 `recommendUtils.ts`에서 `medication_pk_profile` 우선 + `KEYWORD_TO_CLASS` fallback 2단 구조 구현 완료로 완화하나, 신약/제네릭 미커버 시 기본값 fallback(안전). **한계 잔존(추적 필요)**.
5. **CR/IR 구분 난이도 — ⚠️ 구현으로 완화·잔존**: 식약처 `CLASS_NAME`으로 구분 불가, 약명에 "CR/서방/HBS" 표기 없으면 IR로 분류될 위험. Phase 1 키워드 매칭(CR 키워드 우선 정렬)으로 완화했으나 약명 표기 부재 시 IR 분류 위험 잔존. 보수적으로 IR(짧은 추적)이 환자 부담 적어 안전측. **한계 잔존(추적 필요)**.
6. **사용자 수정값 보존 판정 — ✅ 오너 확정으로 종결(2026-05-18, Phase 3-4 구현 완료)**:

   **오너 확정 기준(변경 금지)**: "추천 적용 이후 사용자가 약효추적 알림을 **시점 ON/OFF · 시간 변경 · 추가 · 삭제 중 하나라도** 하면 `userEdited=true`. 이후 재추천은 **자동으로 절대 안 덮고**, **비강제 제안 다이얼로그로만** 안내하며, 사용자가 **'새 시간으로 맞출게요'를 명시적으로 선택했을 때에만** 교체한다."

   **판정 방식 확정**: `med_notif_prefs` DB 존재 여부만으로는 "추천 적용분"과 "사용자 수정분"을 구분 불가하므로, `med_notif_recommendation_meta.userEdited`(명시적 플래그, §8.1)를 단일 판정 기준으로 한다. DB 존재 여부는 보조 신호로만 사용한다.

   **트리거 확정**: 추천 적용 이후 발생한 ① 시점 개별 토글 ON/OFF ② 시점 시간 변경 ③ 시점 추가 ④ 시점 삭제 — **이 4개 동작 중 하나라도** 발생하면 `userEdited=true`로 잠근다(SettingsScreen `toggleMed`/`saveMedTime`/`deleteMed`, SettingsContext 트리거 — §14 Phase 3-4 구현).

   **재추천 정책**: `userEdited===true`이면 재추천은 **자동 적용 절대 금지**. 비강제 제안 다이얼로그("등록한 약이 바뀌었어요. 새 시간으로 맞출까요?")만 띄우고, 사용자가 [새 시간으로 맞출게요] 명시 선택 시에만 교체(이때 새 기준 확정). [그대로 둘게요] 선택 시 사용자 값 유지. **출시 전 테스트 단계라 기존 사용자 마이그레이션 시나리오는 없음(§3-B 전제)** → 이 정책으로 종결, 추적 종료.
7. **큐레이션 수치 임상 검증 — ✅ 오너 결정으로 해결(2026-05-18)**: **오너 결정: 의학 자문(임상 자문) 미진행**. 사유 — 의학 자문이 들어가면 일이 과도하게 커진다(오너 판단). 큐레이션 분 단위 추천값은 **"일반 참고 추천"으로만** 제시하며, 책임 경계는 다음 4가지로 갈음한다(해결): ① 추천값이 확정 처방이 아닌 일반 참고 추천임을 UI에 명시 ② "환자분 상태에 따라 다를 수 있으니 주치의와 상의하세요" 디스클레이머 상시 노출 ③ "식약처 약 정보 직접 보기" 원문 링크로 사용자가 공식 출처를 직접 확인(앱이 출처를 사칭하지 않음 — §4-A) ④ 추천은 비강제 — 사용자가 최종 선택·수정(§3-C). → 별도 임상 자문 절차는 진행하지 않는다(추후 권장 사항이 아닌 확정 종결).
8. **ITEM_SEQ 수신 — ✅ 검증 완료 + 파싱 구현 완료(2026-05-18, Phase 1-bis)**: 낱알식별 API(`MdcinGrnIdntfcInfoService03`) 실응답에 `ITEM_SEQ`(9자리 숫자 문자열)가 **항상 포함됨**을 실응답으로 검증 완료(예: 퍼킨정25-100mg=199201045, 리큅정1mg=200108699). **Phase 1-bis 구현 완료**: `DrugInfo`에 `itemSeq?: string` 추가, `MedicationRegisterScreen.tsx`(`searchMfdsInfo`)·`MedicationManageScreen.tsx`(`grnHit`) 2화면 파싱 추가, `medications.item_seq` 원격 마이그레이션 적용 완료, `database.ts` 타입 반영. 순수 JS/TS + 서버측 컬럼(OTA 가능). **종결**.
9. **의약품안전나라 약 상세 URL — ✅ 검증 완료, URL 확정(2026-05-18)**: `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq={ITEM_SEQ}` 확정(서버가 cacheSeq로 자동 302 리다이렉트, 클라이언트는 ITEM_SEQ만 알면 됨). 폴백: 약명 통합검색 `https://nedrug.mfds.go.kr/searchDrug?searchYn=true&keyword={URL인코딩 약명}`. 외부 브라우저 `Linking.openURL`(WebView 금지). **남은 한계(리스크 유지)**: 규격별 ITEM_SEQ가 상이하여, 약 등록 시 매칭된 첫 결과 기준 대표 링크가 실제 복용 규격과 다를 수 있음. 추천 카드에서 실시간 재검색하지 않으므로(§3-F) 등록 시 정확한 규격 선택 의존.
10. **약/용량 변경 감지 정확도 — ⚠️ 구현으로 완화·잔존**: Phase 3-4에서 §8.1 `sourceMedSignature`에 **용량 포함** 구현 완료 → IR↔CR·계열 변경·레보도파 추가제거·**용량 변경**을 시그니처 비교로 감지(약 추가/삭제/계열·제형 변경 + 용량 변경 모두 → 비강제 제안 다이얼로그). 다만 약명만으로 IR/CR 구분이 어려운 경우(§13-5) 시그니처가 불완전할 수 있음 → `medication_pk_profile` 우선 + 키워드 fallback과 동일 한계 공유. **한계 잔존(추적 필요)**.

---

## 14. 구현 현황 (Phase 1·1-bis·2·3-4 완료 — 2026-05-18)

> 본 섹션은 실제 구현 완료 산출물 기록이다. 코드 경로는 산출 시점 기준. 서버 푸시 경로(`queue-effect-tracking`/`process-notification-queue`/`effect_tracking_queue` 스키마/`useMedication.ts` 큐 호출부)는 **전 Phase 무수정 유지**(§4.4·§6·§7-X.6·§12 무변경 원칙 준수, CLAUDE.md 알림 규칙).

### Phase 1 — 큐레이션 데이터 · 추천 엔진 ✅ 완료
- `src/constants/medEffectProfiles.ts` (신규): 분류 정의(`DrugClass`)·`CLASS_RECOMMENDATION`·`KEYWORD_TO_CLASS`·`TrackingRecommendation` 타입. 레보도파 계열만 `active:true`, 비레보도파 전부 `active:false`+`note`(§3-A·§4).
- `src/utils/recommendUtils.ts` (신규): `resolveTrackingRecommendation(medName, mfdsInfo?, ediCode?)`, `buildRecommendedMedNotifs(meds)`(다약 union·중복제거·정렬), `medication_pk_profile` 조회 헬퍼(EDI/품명, MedicationManageScreen 기존 로직 공용화). 매칭 실패 시 `null` → 호출부 `DEFAULT_MED_NOTIFS` fallback(회귀 방지).

### Phase 1-bis — ITEM_SEQ 파싱 + DB 컬럼 ✅ 완료 (§13-8 종결)
- `DrugInfo.itemSeq` 파싱: `MedicationRegisterScreen.tsx`(`searchMfdsInfo`)·`MedicationManageScreen.tsx`(`grnHit`) **2화면** 모두 `itemSeq: item.ITEM_SEQ` 파싱 추가.
- `medications.item_seq`(text, nullable) 컬럼 마이그레이션 **원격 Supabase 적용 완료**(서버측, OTA·재심사 무관 — §3-F·§8).
- `database.ts` 타입에 `item_seq` 반영. 약 저장/수정 시 `medications.item_seq` 기록.

### Phase 2 — 온보딩 연동 ✅ 완료 (§13-2 옵션 1 종결)
- `NotificationSetupScreen.tsx`: 하드코딩 after30/after2h 옵션 → `onboarding_medications` 기반 **추천 카드 4상태**(① 레보도파 정상 ② 비레보도파만 ③ 약 없음 ④ 매칭 실패 fallback, §7-X.5) 렌더. `handleConfirm`에서 `useSettings().setMedNotifs(추천 MedNotif[])` 직접 호출 + `med_notif_recommendation_meta` 저장.
- `FamilyInviteScreen.tsx`: **손실성 하드코딩 브리지(204-216행) 교체** — after30/after2h만 인식 → 추천 `MedNotif[]` 무손실 통과.
- `SettingsContext.tsx`: `DEFAULT_MED_NOTIFS` export(추천 fallback 공용화).

### Phase 3-4 — 약 관리·재추천·사용자 수정값 보존 ✅ 완료 (§13-6 종결)
- `src/utils/medNotifRecommendationMeta.ts` (신규): `MedNotifRecommendationMeta`(`recommendedFromClasses`/`sourceMedSignature`/`userEdited`/`lastAppliedAt`) AsyncStorage 입출력. `sourceMedSignature`에 **용량 포함**(약명@용량 정렬·해시 — §8.1·§13-10).
- `MedicationManageScreen.tsx`: 재추천 진입점 + 비강제 제안 다이얼로그(약 추가/삭제/계열·제형/용량 변경 시 `sourceMedSignature` 불일치 → "새 시간으로 맞출까요?"). 레보도파 0개 시 강제변경 없이 안심 안내(§3-A·§7-X.3 E).
- `SettingsScreen.tsx`: `userEdited` 트리거 — `toggleMed`(시점 ON/OFF)·`saveMedTime`(시간 변경)·`deleteMed`(삭제) 중 하나라도 발생 시 `userEdited=true` 잠금(§13-6 오너 확정 기준).
- `SettingsContext.tsx`: 로드 시 추천 초기 채움 vs `userEdited` 우선순위 — `userEdited===true`이면 자동 적용 절대 금지, 비강제 제안 다이얼로그만, 사용자 명시 선택 시에만 교체.

### 재추천 트리거 확정 (구현 반영)
- **약 추가 / 삭제 / 계열·제형 변경 + 용량 변경** 모두 → `sourceMedSignature` 불일치 감지 → **비강제 제안 다이얼로그**(자동 적용 금지). 사용자 [새 시간으로 맞출게요] 명시 선택 시에만 교체.
- **레보도파 0개**(전부 비레보도파/약 없음) 시 → 강제 변경 없이 **안심 안내**("약은 평소대로 잘 챙기시면 돼요" — §7-X.3 E/F). 기존 사용자 값 보존.

### 서버 푸시 무수정 원칙 — 전 Phase 재확인 ✅
- `supabase/functions/queue-effect-tracking/index.ts` — 무수정.
- `process-notification-queue` — 무수정.
- `effect_tracking_queue` 스키마 — 무변경.
- `useMedication.ts` 서버 큐 호출부(`takeMedication`→`queue-effect-tracking` 전달) — 무수정.
- 추천 적용은 `medNotifs` 값 결정 로직에만 개입. medNotifs에 추천값이 실리면 기존 서버 푸시 경로로 무수정 자동 도달(§6·§13-2). CLAUDE.md 알림 규칙(로컬 알림 대체 금지) 준수.

### 미구현(추적·선택)
- Phase 4-bis 추천 카드 식약처 원문 링크 오픈(저장된 `item_seq` → `Linking.openURL`)은 파싱·컬럼까지 완료, 카드 버튼 연결은 §4-A/§7.2-bis UI 후속.
- Phase 5(pk_profile 시드 보강 SQL) 선택, 미진행(§13-1 잔존).
- Phase 6 검수 / Phase 7 OTA 배포는 별도 진행.
