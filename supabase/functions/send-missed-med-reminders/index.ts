import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

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

Deno.serve(async (req: Request) => {
  const { meal_time } = await req.json()

  if (!MEAL_LABELS[meal_time]) {
    return new Response(JSON.stringify({ error: 'invalid meal_time' }), { status: 400 })
  }

  const { data: patients } = await supabase
    .from('users')
    .select('id, name, push_token, patient_group_id, med_time_notif_prefs')
    .eq('role', 'patient')
    .eq('notification_enabled', true)
    .not('push_token', 'is', null)

  if (!patients?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const today = kstNow.toISOString().split('T')[0]

  let patientSent = 0
  let caregiverSent = 0

  for (const patient of patients) {
    if (!patient.push_token) continue

    // med_time_notif_prefs 확인: 해당 meal_time 알림이 꺼져 있으면 건너뜀
    // prefs 구조: { morning: boolean, lunch: boolean, dinner: boolean, bedtime: boolean }
    // null/undefined이면 기본값 true (알림 활성화)
    const medTimePrefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>
    if (medTimePrefs[meal_time] === false) continue

    const { data: logs } = await supabase
      .from('med_logs')
      .select('id')
      .eq('patient_id', patient.id)
      .eq('meal_time', meal_time)
      .gte('taken_at', `${today}T00:00:00+09:00`)
      .lte('taken_at', `${today}T23:59:59+09:00`)
      .limit(1)

    if (logs?.length) continue

    await sendPush(
      patient.push_token,
      '💊 약을 아직 안 드셨어요',
      `${MEAL_LABELS[meal_time]} 약을 아직 드시지 않으셨어요.`,
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
          .select('push_token, caregiver_notif_prefs')
          .in('id', caregivers.map((c: any) => c.user_id))
          .not('push_token', 'is', null)

        for (const cu of caregiverUsers ?? []) {
          if (!cu.push_token) continue
          const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>
          if (prefs.med_missed === false) continue

          const patientName = (patient as any).name?.trim()
          const subject = patientName ? `${patientName}님` : '환자분'
          await sendPush(
            cu.push_token,
            '💊 약을 안 드셨어요',
            `${subject}이 ${MEAL_LABELS[meal_time]} 약을 아직 안 드셨어요.`,
            { type: 'caregiver_missed_med', mealTime: meal_time },
          )
          caregiverSent++
        }
      }
    }
  }

  return new Response(JSON.stringify({ patientSent, caregiverSent }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
