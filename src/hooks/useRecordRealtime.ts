import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * 기록 테이블(med_logs / on_off_logs / exercise_logs) 실시간 구독.
 * 지정한 환자(patientId)의 기록이 추가/삭제/수정되면 onChange를 호출한다.
 * → 한 기기(환자 또는 보호자)에서 기록을 남기거나 취소하면 상대 기기 화면도 즉시 갱신.
 *
 * - DELETE 이벤트 필터(patient_id)가 동작하려면 해당 테이블이 REPLICA IDENTITY FULL 이어야 함(설정 완료).
 * - onChange는 매 렌더 새 함수여도 재구독되지 않도록 ref로 보관한다.
 */
export function useRecordRealtime(
  table: 'med_logs' | 'on_off_logs' | 'exercise_logs',
  patientId: string | null | undefined,
  onChange: () => void,
) {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!patientId) return;

    const topic = `records-${table}-${patientId}`;
    // 같은 topic 의 잔존 채널 제거(재진입/StrictMode 이중 호출 시 이미 subscribe() 된
    // 채널을 supabase.channel() 이 재사용 → .on() 추가 시도하다 throw 하는 크래시 방지).
    supabase
      .getChannels()
      .filter((c) => c.topic === `realtime:${topic}` || c.topic === topic)
      .forEach((c) => { supabase.removeChannel(c); });

    // .on('postgres_changes', ...) 는 반드시 .subscribe() 이전에 모두 등록.
    const channel = supabase.channel(topic);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `patient_id=eq.${patientId}` },
      () => { cb.current(); },
    );
    channel.subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [table, patientId]);
}
