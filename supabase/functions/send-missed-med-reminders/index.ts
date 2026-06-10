import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// legacy 4슬롯 라벨 fallback. dose_slot 경로에선 dose_slots.label을 우선 사용.
const MEAL_LABELS: Record<string, string> = {
  morning: '아침',
  lunch: '점심',
  dinner: '저녁',
  bedtime: '취침',
}

async function sendPush(to: string, title: string, body: string, data: Record<string, unknown>) {
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
      channelId: 'default',
    }),
  })
}

/**
 * 이 함수는 유지(폐기 안 함). 구버전 호환을 위해 기존 meal_time 경로를 100% 보존하고,
 * 신규 dose_slot_id 요청도 받을 수 있게 이중 분기를 추가한다.
 *
 * 요청 형태(둘 중 하나):
 *  - 구(legacy):  { meal_time: 'morning' | 'lunch' | 'dinner' | 'bedtime' }
 *  - 신(dose_slot): { dose_slot_id: '<uuid>' }  (meal_time 동시 전달 가능, 옵션)
 */
Deno.serve(async (req: Request) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const meal_time: string | undefined = body.meal_time
  const dose_slot_id: string | undefined = body.dose_slot_id

  // ─── 분기 결정 ───────────────────────────────────────────────────
  // dose_slot_id가 오면 신규 경로(특정 환자 슬롯), 아니면 구 meal_time 경로(전체 환자).
  if (!dose_slot_id && (!meal_time || !MEAL_LABELS[meal_time])) {
    return new Response(JSON.stringify({ error: 'invalid request: meal_time or dose_slot_id required' }), { status: 400 })
  }

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const today = kstNow.toISOString().split('T')[0]
  const dayStart = `${today}T00:00:00+09:00`
  const dayEnd = `${today}T23:59:59+09:00`

  let patientSent = 0
  let caregiverSent = 0

  // ============================================================
  // 신규 경로: dose_slot_id 1개 — 그 슬롯 환자에게만
  // ============================================================
  if (dose_slot_id) {
    const { data: slot } = await supabase
      .from('dose_slots')
      .select('id, patient_id, label, remind_enabled, is_active')
      .eq('id', dose_slot_id)
      .maybeSingle()

    if (!slot || !slot.is_active || slot.remind_enabled === false) {
      return new Response(JSON.stringify({ patientSent: 0, caregiverSent: 0, skipped: 'slot inactive/disabled' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const { data: patient } = await supabase
      .from('users')
      .select('id, name, push_token, notification_enabled, patient_group_id')
      .eq('id', slot.patient_id)
      .maybeSingle()

    if (!patient?.push_token || !patient.notification_enabled) {
      return new Response(JSON.stringify({ patientSent: 0, caregiverSent: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 복용 여부: dose_slot_id 기록 + (있다면) meal_time 기록 union
    const { data: bySlot } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', patient.id)
      .eq('dose_slot_id', dose_slot_id)
      .gte('taken_at', dayStart)
      .lte('taken_at', dayEnd)
      .limit(1)
    let taken = !!bySlot?.length
    if (!taken && meal_time && MEAL_LABELS[meal_time]) {
      const { data: byMeal } = await supabase
        .from('med_logs')
        .select('id')
        .eq('patient_id', patient.id)
        .eq('meal_time', meal_time)
        .gte('taken_at', dayStart)
        .lte('taken_at', dayEnd)
        .limit(1)
      taken = !!byMeal?.length
    }

    if (taken) {
      return new Response(JSON.stringify({ patientSent: 0, caregiverSent: 0, skipped: 'already taken' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const label = (slot.label && slot.label.trim()) || (meal_time ? MEAL_LABELS[meal_time] : '') || '약'

    await sendPush(
      patient.push_token,
      '💊 약을 아직 안 드셨어요',
      `${label} 약을 아직 드시지 않으셨어요.`,
      { type: 'missed_medication', mealTime: meal_time ?? null, doseSlotId: dose_slot_id },
    )
    patientSent++

    if (patient.patient_group_id) {
      const { data: caregivers } = await supabase
        .from('patient_group_members')
        .select('user_id')
        .eq('group_id', patient.patient_group_id)
        .eq('role', 'caregiver')

      if (caregivers?.length) {
        const { data: caregiverUsers } = await supabase
          .from('users')
          .select('id, push_token, caregiver_notif_prefs')
          .in('id', caregivers.map((c: any) => c.user_id))
          .not('push_token', 'is', null)

        const patientName = (patient as any).name?.trim()
        const subject = patientName ? `${patientName}님` : '환자분'
        const cgTitle = '💊 약을 안 드셨어요'
        const cgBody = `${subject}이 ${label} 약을 아직 안 드셨어요.`

        for (const cu of caregiverUsers ?? []) {
          if (!cu.push_token) continue
          const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>
          if (prefs.med_missed === false) continue
          await sendPush(cu.push_token, cgTitle, cgBody, {
            type: 'caregiver_missed_med',
            mealTime: meal_time ?? null,
            doseSlotId: dose_slot_id,
          })
          await supabase.from('notification_logs').insert({
            user_id: cu.id,
            type: 'caregiver_missed_med',
            title: cgTitle,
            body: cgBody,
            data: { type: 'caregiver_missed_med', mealTime: meal_time ?? null, doseSlotId: dose_slot_id },
          })
          caregiverSent++
        }
      }
    }

    return new Response(JSON.stringify({ patientSent, caregiverSent }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ============================================================
  // 구 경로 (legacy, 100% 보존): meal_time — 전체 환자 순회
  // ============================================================
  const { data: patients } = await supabase
    .from('users')
    .select('id, name, push_token, patient_group_id, med_time_notif_prefs')
    .eq('role', 'patient')
    .eq('notification_enabled', true)
    .not('push_token', 'is', null)

  if (!patients?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  for (const patient of patients) {
    if (!patient.push_token) continue

    // med_time_notif_prefs 확인: 해당 meal_time 알림이 꺼져 있으면 건너뜀
    // prefs 구조: { morning: boolean, lunch: boolean, dinner: boolean, bedtime: boolean }
    // null/undefined이면 기본값 true (알림 활성화)
    const medTimePrefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    if (medTimePrefs[meal_time!] === false) continue

    const { data: logs } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', patient.id)
      .eq('meal_time', meal_time)
      .gte('taken_at', dayStart)
      .lte('taken_at', dayEnd)
      .limit(1)

    if (logs?.length) continue

    await sendPush(
      patient.push_token,
      '💊 약을 아직 안 드셨어요',
      `${MEAL_LABELS[meal_time!]} 약을 아직 드시지 않으셨어요.`,
      { type: 'missed_medication', mealTime: meal_time },
    )
    patientSent++

    if (patient.patient_group_id) {
      const { data: caregivers } = await supabase
        .from('patient_group_members')
        .select('user_id')
        .eq('group_id', patient.patient_group_id)
        .eq('role', 'caregiver')

      if (caregivers?.length) {
        const { data: caregiverUsers } = await supabase
          .from('users')
          .select('id, push_token, caregiver_notif_prefs')
          .in('id', caregivers.map((c: any) => c.user_id))
          .not('push_token', 'is', null)

        for (const cu of caregiverUsers ?? []) {
          if (!cu.push_token) continue
          const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>
          if (prefs.med_missed === false) continue

          const patientName = (patient as any).name?.trim()
          const subject = patientName ? `${patientName}님` : '환자분'
          const cgTitle = '💊 약을 안 드셨어요'
          const cgBody = `${subject}이 ${MEAL_LABELS[meal_time!]} 약을 아직 안 드셨어요.`
          await sendPush(
            cu.push_token,
            cgTitle,
            cgBody,
            { type: 'caregiver_missed_med', mealTime: meal_time },
          )
          // 보호자 종 아이콘 알림 내역용 기록 (service role)
          await supabase.from('notification_logs').insert({
            user_id: cu.id,
            type: 'caregiver_missed_med',
            title: cgTitle,
            body: cgBody,
            data: { type: 'caregiver_missed_med', mealTime: meal_time },
          })
          caregiverSent++
        }
      }
    }
  }

  return new Response(JSON.stringify({ patientSent, caregiverSent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
