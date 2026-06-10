import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const INTERVAL_LABELS: Record<number, string> = {
  0: '복용 직후',
  30: '30분 후',
  120: '2시간 후',
}

const MEAL_LABELS: Record<string, string> = {
  morning: '아침약',
  lunch: '점심약',
  dinner: '저녁약',
  bedtime: '취침약',
}

/**
 * 큐 1건의 표시 라벨 결정.
 *  - 신규: dose_slot_id 있으면 dose_slots.label 사용("아침" → "아침약"처럼 '약' 접미)
 *  - 구(legacy): meal_time + MEAL_LABELS fallback
 *  - 둘 다 없으면 '' (일반 "약 복용 …" 문구)
 */
function resolveMealLabel(
  doseSlot: { label?: string | null } | null | undefined,
  mealTime: string | null | undefined,
): string {
  const slotLabel = doseSlot?.label?.trim()
  if (slotLabel) return slotLabel.endsWith('약') ? slotLabel : `${slotLabel}약`
  if (mealTime) return MEAL_LABELS[mealTime] ?? ''
  return ''
}

function getIntervalLabel(minutes: number): string {
  if (INTERVAL_LABELS[minutes]) return INTERVAL_LABELS[minutes]
  if (minutes < 60) return `${minutes}분 후`
  const h = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`
}

async function sendPush(to: string, title: string, body: string, data: Record<string, unknown>, channelId = 'default'): Promise<boolean> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId,
      // 디지털 바이오마커 MVP-A Phase 4 — 약효추적 알림 액션 버튼 '바로 측정하기'.
      // 본 함수는 effect_tracking_queue 전용이라 모든 푸시에 categoryId='effect_tracking' 부여.
      // 클라이언트(App.tsx)가 Notifications.setNotificationCategoryAsync('effect_tracking', ...)로
      // 'measure_now' 액션을 등록 → 시스템 알림 UI에 액션 버튼 노출.
      categoryId: 'effect_tracking',
    }),
  })
  const result = await res.json()
  const ok = result?.data?.status === 'ok'
  console.log('[process-queue sendPush]', JSON.stringify({ to: to.slice(0, 30), status: result?.data?.status, result }))
  return ok
}

Deno.serve(async (_req: Request) => {
  const now = new Date()

  // dose_slot_id가 있으면 dose_slots를 join해 label/track_sound_id를 동적으로 해석.
  // 구 데이터(dose_slot_id NULL)는 join이 null로 와서 meal_time fallback 경로 사용.
  const { data: pending } = await supabase
    .from('effect_tracking_queue')
    .select('*, dose_slot:dose_slots(label, track_sound_id)')
    .lte('send_at', now.toISOString())
    .is('sent_at', null)
    .limit(100)

  if (!pending?.length) {
    return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  let processed = 0

  for (const item of pending) {
    // Atomic claim: sent_at을 먼저 선점해 동시 실행 시 중복 처리 방지
    const { data: claimed } = await supabase
      .from('effect_tracking_queue')
      .update({ sent_at: now.toISOString() })
      .eq('id', item.id)
      .is('sent_at', null)
      .select('id')

    if (!claimed || claimed.length === 0) {
      console.log('[process-queue] 이미 처리된 항목 건너뜀:', item.id)
      continue
    }

    const label = getIntervalLabel(item.interval_minutes)
    // dose_slot 조인은 단일 객체 또는 배열로 올 수 있어 정규화.
    const doseSlot = Array.isArray(item.dose_slot) ? (item.dose_slot[0] ?? null) : (item.dose_slot ?? null)
    const mealLabel = resolveMealLabel(doseSlot, item.meal_time)
    const bodyText = mealLabel
      ? `${mealLabel} 복용 ${label} 몸 상태를 기록해보세요.`
      : `약 복용 ${label} 몸 상태를 기록해보세요.`

    // 목소리(채널) 결정:
    //  1) 큐에 직접 지정된 sound_id(구 경로) 우선
    //  2) 없으면 신규 경로: dose_slot.track_sound_id
    //  3) 둘 다 없으면 시스템 기본음('default')
    const soundId = item.sound_id ?? doseSlot?.track_sound_id ?? null
    const channelId = soundId ? `parkinon_alarm_${soundId}` : 'default'
    const ok = await sendPush(
      item.push_token,
      '😊 몸 상태는 어때요?',
      bodyText,
      { type: 'effect_tracking', minutes: item.interval_minutes, meal_time: item.meal_time ?? null, doseSlotId: item.dose_slot_id ?? null, med_log_id: item.med_log_id ?? null },
      channelId,
    )

    if (ok) {
      await supabase.from('notification_logs').insert({
        user_id: item.patient_id,
        type: 'effect_tracking',
        title: '😊 몸 상태는 어때요?',
        body: bodyText,
        data: { type: 'effect_tracking', minutes: item.interval_minutes, meal_time: item.meal_time ?? null, doseSlotId: item.dose_slot_id ?? null, med_log_id: item.med_log_id ?? null },
        read_at: null,
      })
      processed++
    } else {
      // 푸시 실패 → sent_at 초기화해 재시도 가능하게
      await supabase
        .from('effect_tracking_queue')
        .update({ sent_at: null })
        .eq('id', item.id)
      console.error('[process-queue] push 실패 — sent_at 초기화, 재시도 대기:', item.id)
    }
  }

  return new Response(JSON.stringify({ processed }), { headers: { 'Content-Type': 'application/json' } })
})
