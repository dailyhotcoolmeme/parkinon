# 가족 연동 방향-무관 안전 재설계 (구현·라이브검증 완료)

> 2026-06-26 설계 정리 → 같은 날 구현 완료. 오너 결정 A/B/C 모두 반영.
>
> ## ✅ 구현 결과 (2026-06-26)
> - **DB 마이그(적용완료)** `family_link_direction_safe_redesign`:
>   - `uniq_one_patient_per_group` = `patient_group_members(group_id) WHERE role='patient'` → 환자2명 원천차단.
>   - `join_family_by_code(p_code text, p_force boolean)` SECURITY DEFINER RPC → 방향-무관 합류/병합·서버 게이트 재검증. 반환 `jsonb{ok,code,message}` (사유코드: joined / merged_caregivers / already_member / invalid_code / two_patients / need_confirm_switch / error).
>   - 내부 헬퍼 `_fl_move_self_into_group` (anon/authenticated EXECUTE revoke).
> - **클라(OTA 대상)**:
>   - `src/hooks/useFamilyLink.ts`: `joinByCode`/`joinByCodeForce` → 신규 RPC 경유(`_callJoinRpc`). 위험한 `_doJoin`(환자 이동) 제거.
>   - `src/screens/onboarding/FamilyCheckScreen.tsx`: 환자 없는 보호자 선그룹 코드도 통과(masked-name 게이트 완화 + "아직 환자 없는 가족 그룹" 안내).
>   - `src/screens/onboarding/FamilyInviteScreen.tsx`: 코드 합류를 RPC로 원자 처리(denorm 선세팅 제거, two_patients 안내). 코드 없는 group_id-only는 구버전 폴백 유지.
> - **라이브 검증(ROLLBACK 트랜잭션, 라이브 불변 확인)**: 보호자→환자그룹 합류 / 환자→보호자선그룹(환자 이동X·보호자 끌어오기) / 환자2명 거부 / 보호자 갈아타기(need_confirm→force) 전부 의도대로. 기존 94c9·c2f7 불변, denorm 불일치 0.
> - `npx tsc --noEmit`: 편집 3파일 신규 에러 0 (나머지는 기존 에러).

## 배경 / 오너 요구
파킨온 가족 연동 = 환자 1 : 보호자 N. 현재 코드는 "한 유저 = 한 그룹"(1:1) 가정이라, 코드 입력 방향이 거꾸로면 **환자가 기존 그룹을 떠나 기존 보호자 연동이 끊기는 위험**(변경 팝업).
- (1) 방향 무관 안전: 누가 코드 발급/입력하든 "보호자가 환자 그룹에 N명 합류"가 되고 기존 보호자 안 끊김.
- (2) 보호자끼리 선(先)그룹 형성 허용 → 나중에 환자 후합류 가능.
- (3) 불가능 케이스는 막되 사유 안내(일관성 — "된다 해놓고 나중에 막히면 낭패" 금지).

## 데이터 모델 (avqaflxufyadgzjiojkk)
- `patient_groups(id, invite_code UNIQUE, invite_code_expires_at, ...)` — 환자 0명 그룹 허용(실제 c2f7 = 보호자만).
- `patient_group_members(group_id, user_id, role['patient'|'caregiver'] CHECK, ...)` — UNIQUE(group_id,user_id), FK CASCADE. **환자 2명 막는 DB 제약 없음**.
- `users.patient_group_id` 단일 → "보호자 1 : 환자그룹 1" 한계(보호자 다중환자 케어 불가).
- **RLS 핵심(구현 방향 결정)**: `users_update_own`(auth.uid()=id), `pgm_delete_own`(user_id=auth.uid()) → **나는 내 행만 수정/삭제. 남의 멤버십·남의 users.patient_group_id 못 바꿈** → "남을 내 그룹으로 끌어오는 병합"은 **SECURITY DEFINER RPC 필수**.
- `get_invite_patient_masked_name(code)`: 그룹에 환자 있을 때만 이름 반환 → **온보딩 FamilyCheckScreen은 "환자 있는 그룹 코드"만 통과**(보호자 선그룹 코드는 온보딩서 "코드오류").

## 위험은 단 하나: "환자 본인이 이동당하는 경로"
`_doJoin`은 항상 "입력자 본인"만 이동. 환자가 다른 코드 입력→force 시 환자가 그룹 떠남=기존 보호자 끊김. (오너가 겪은 케이스: 보호자가 코드 발급→환자가 입력.)

## 시나리오 처리 (요약)
- 보호자가 환자그룹 코드 입력 → **합류**(정상, 현행 유지).
- 보호자→보호자 선그룹 / 보호자만 그룹 병합 → **합류**(단 여러 보호자 통째 병합은 RPC 필요, 클라 단독은 본인만 이동).
- 환자가 보호자 코드 입력(본인 이미 보호자 있는 그룹) → **환자 이동 금지**. RPC로 "발급 보호자를 환자 그룹에 합류" 또는 막고 "보호자가 환자 코드를 입력하세요" 안내.
- **환자 2명 한 그룹 → 무조건 막기**: "환자 두 분은 한 가족으로 묶을 수 없어요. 환자 한 분 중심으로 보호자들이 함께 연결돼요."
- 보호자가 다른 환자로 갈아타기 → 명시 확인: "지금 □□님과 연결돼 있어요. ○○님으로 바꾸면 □□님 연결이 끊겨요. 바꾸시겠어요?"

## 구현 방향
- `useFamilyLink.ts joinByCode`(291~314)의 "기존그룹 환자유무"만 보는 분기를 **4-사실 판정**(입력자 role / 발급그룹 환자유무 / 입력자 현재그룹 환자유무 / 보호자 동반)으로 확장.
- **신규 SECURITY DEFINER RPC** 필수(병합·타인 끌어오기·서버 게이트 재검증). 환자2명·만료 서버 차단.
- (선택·권장) DB partial unique: `CREATE UNIQUE INDEX ON patient_group_members(group_id) WHERE role='patient'` → 환자2명 원천차단.

## ⚠️ 오너 결정 필요 (구현 전)
- **(A)** 온보딩에서 "보호자 선그룹"(#6/#8) 허용? → masked-name 게이트 완화 + 안내문구 신설 필요.
- **(B)** 환자가 보호자코드 입력 시(#9): RPC로 보호자 끌어오기까지 구현 vs "보호자가 환자 코드 입력"으로 방향만 유도.
- **(C)** 환자2명 차단을 앱 로직만 vs DB partial unique까지.

## 관련 파일
src/hooks/useFamilyLink.ts, src/utils/groupMembership.ts, src/screens/menu/FamilyLinkScreen.tsx, src/screens/onboarding/FamilyInviteScreen.tsx·FamilyCheckScreen.tsx. RPC: is_same_patient_group, get_invite_patient_masked_name.
