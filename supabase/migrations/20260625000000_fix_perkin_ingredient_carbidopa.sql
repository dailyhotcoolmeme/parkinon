-- 퍼킨정(명인제약) 성분 정정
-- 오류: levodopa+benserazide / "마도파 제네릭" 으로 잘못 등록됨
-- 정정: 퍼킨정 = levodopa+carbidopa = 시네메트정(한국MSD) 동일성분·함량 대체약(시네메트 IR 제네릭)
-- 근거: 드럭인포 EDI 651902270(25-250mg)/651902260(25-100mg), 세브란스 의약정보(Sinemet 동일성분 대체약 Perkin), 약학정보원 먼약
-- PK 수치(onset 30 / tmax 45 / duration 300 / suggested_slots [0,30,120,240])는
--   시네메트정 IR 행과 동일하므로(검증 완료) 그대로 유지. drug_class 'levodopa'도 유지.
UPDATE medication_pk_profile
SET ingredient = 'levodopa+carbidopa',
    notes = '시네메트(레보도파+카르비도파) 동일성분 대체약'
WHERE product_name = '퍼킨정';
