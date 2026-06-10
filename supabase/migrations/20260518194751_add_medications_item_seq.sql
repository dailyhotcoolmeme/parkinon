-- 식약처 낱알식별 API ITEM_SEQ 저장용 컬럼 추가 (Phase 1-bis)
-- 약 등록 시점에 받은 ITEM_SEQ를 저장하여 추천 카드의
-- "식약처 약 정보 직접 보기"(의약품안전나라 원문 링크)에 사용한다.
-- nullable: ITEM_SEQ 매칭 실패 시 null 허용.
ALTER TABLE medications ADD COLUMN IF NOT EXISTS item_seq text;
