-- effect_tracking_queue 약효추적 알림 중복 발송 서버측 멱등 차단
--
-- 배경: 약 복용 저장 버튼 더블탭 → takeMedication 동시 2회 → queue-effect-tracking 엣지함수도
--       동시 2회 실행. 이 함수의 dedup 은 "같은 med_log_id 미발송 행 delete 후 insert" 로 비원자적이라,
--       두 호출이 거의 동시에 delete(둘 다 0행 삭제) → 각각 insert 하면 같은 (med_log_id, interval)
--       조합이 2~3세트로 쌓여 같은 복용에 약효추적 알림이 2~3번 발송됐다(라이브 확정).
--
-- 조치: 미발송(sent_at IS NULL) 큐 행에 (med_log_id, interval_minutes) 부분 유니크 인덱스.
--       동시 insert 가 들어와도 두 번째는 제약 위반으로 거부 → 같은 복용·같은 인터벌은 항상 1행.
--       이미 발송된 행(sent_at IS NOT NULL)은 제약 밖이라 다음날 같은 복용 재기록/재큐잉에 영향 없음.
--       med_log_id 가 NULL 인 legacy(meal_time) 행은 인덱스 대상에서 제외(부분 조건).
--
-- 엣지함수(queue-effect-tracking) 는 이 제약을 위반해도 깨지지 않도록 insert 를
-- onConflict ignore(upsert) 로 변경했다(별도 배포 필요).
--
-- 안전성: 적용 전 미발송 중복 행 0건 확인됨(중복 없으면 인덱스 생성 실패 안 함).

create unique index if not exists uniq_etq_med_log_interval_unsent
  on public.effect_tracking_queue (med_log_id, interval_minutes)
  where sent_at is null and med_log_id is not null;
