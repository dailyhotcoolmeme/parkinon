# 의약품 제품 허가정보 API 도입 (전문약 약정보) — 계획

상태: **오너 활용신청 대기** (2026-06-15 결정: 정석안=허가정보 API 도입)
관련: `supabase/functions/mfds-proxy/index.ts`, `src/screens/menu/MedicationManageScreen.tsx`(DrugInfoModal), [[project-parkinon-mfds-eyakeunyo-403]]

## 배경/결정
- 파킨온은 파킨슨 앱 → 등록 약 대부분이 **전문의약품**(마도파·시네메트·리큅·미라펙스·스타레보 등).
- **e약은요(`DrbEasyDrugInfoService`, 데이터ID 15075057)는 일반의약품 위주라 전문약 전부 0건** → 약정보 "찾지 못했어요". 테스트로 확정.
- 정석안 채택: **식약처 "의약품 제품 허가정보" API 도입**(전문약 포함, 효능효과/용법용량/주의 narrative 제공).

## 오너 활용신청 대상 (선행)
- 서비스명: **식품의약품안전처_의약품 제품 허가정보**
- 데이터ID: **15095677** · URL: `https://www.data.go.kr/data/15095677/openapi.do`
- 영문ID: `DrugPrdtPrmsnInfoService07`
- **기존 MFDS_KEY 계정으로 추가 활용신청 → 같은 키로 호출 가능**(data.go.kr 계정당 단일 키). 승인되면 코드/키 교체 없이 동작.

## API 사양 (구현용)
- 베이스: `https://apis.data.go.kr/1471000/DrugPrdtPrmsnInfoService07`
- 오퍼레이션:
  - `getDrugPrdtPrmsnInq07` — 허가 **목록**(item_name=약이름 검색 → item_seq)
  - `getDrugPrdtPrmsnDtlInq06` — 허가 **상세**(효능/용법/주의 narrative)
- 파라미터: serviceKey, pageNo, numOfRows, type, item_name 등. (승인 후 마이페이지 Swagger로 오퍼명/케이스 최종대조)
- 핵심 필드: **`EE_DOC_DATA`(효능효과) · `UD_DOC_DATA`(용법용량) · `NB_DOC_DATA`(사용상주의)**
- ⚠️ 이 필드들은 값 안에 **XML(CDATA, `<DOC><SECTION><ARTICLE><PARAGRAPH>...`)이 중첩** → narrative 텍스트만 뽑으려면 **2차 XML 파싱/태그 스트립** 필요(그냥 쓰면 태그 섞임).

## 구현 계획 (승인 후)
1. `mfds-proxy`에 허가정보 엔드포인트 추가: `permit-list`(getDrugPrdtPrmsnInq07), `permit-detail`(getDrugPrdtPrmsnDtlInq06). MFDS_KEY 재사용.
2. `DrugInfoModal`(MedicationManageScreen): 약정보 로드를
   - 1차: e약은요(easy) 시도(일반약이면 그대로) → 0건이면
   - 2차: 허가정보 목록(item_name) → item_seq → 상세 → EE/UD/NB_DOC_DATA XML 파싱 → 효능효과/용법·용량/주의사항(+가능시 부작용·보관) 표시.
   - (등록 약에 item_seq 저장돼 있으면 목록검색 건너뛰고 상세 직행 가능 — medications.item_seq 활용 검토.)
3. XML 파싱 유틸(DOC_DATA → 섹션별 텍스트). 원문 임의 가공 금지(의료 규칙), 태그만 정리.
4. 표시: 효능효과/용법·용량/주의사항/부작용/보관법 섹션. 없으면 숨김. 끝까지 없으면 안내문구.

## 메모
- e약은요(easy)는 일반약엔 여전히 유효 → 1차로 두고 폴백 구조 권장(둘 다 활용).
- 허가상세 XML 구조는 품목별로 섹션 깊이가 달라질 수 있어 파싱 방어 필요.
