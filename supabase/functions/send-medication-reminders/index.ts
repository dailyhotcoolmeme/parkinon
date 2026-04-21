import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const MEAL_LABELS: Record<string, string> = {
  morning: '아침', lunch: '점심', dinner: '저녁', bedtime: '취침',
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

Deno.serve(async (_req: Request) => {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const hh = String(kstNow.getHours()).padStart(2, '0')
  const mm = String(kstNow.getMinutes()).padStart(2, '0')
  const currentTime = `${hh}:${mm}`
  const today = kstNow.toISOString().split('T')[0]

  const { data: matchedMeds } = await supabase.rpc('get_meds_at_time', { target_time: currentTime })

  if (!matchedMeds?.length) {
    return new Response(JSON.stringify({ sent: 0, time: currentTime }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const toNotify: Map<string, Set<string>> = new Map()
  for (const row of matchedMeds) {
    if (!toNotify.has(row.patient_id)) toNotify.set(row.patient_id, new Set())
    toNotify.get(row.patient_id)!.add(row.meal_time)
  }

  let sent = 0

  for (const [patientId, slots] of toNotify.entries()) {
    const { data: patient } = await supabase
      .from('users')
      .select('push_token, notification_enabled, med_time_notif_prefs')
      .eq('id', patientId)
      .single()

    if (!patient?.push_token || !patient.notification_enabled) continue

    const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>

    for (const slot of slots) {
      if (prefs[slot] === false) continue

      const { data: logs } = await supabase
        .from('med_logs')
        .select('id')
        .eq('patient_id', patientId)
        .eq('meal_time', slot)
        .gte('taken_at', `${today}T00:00:00+09:00`)
        .lte('taken_at', `${today}T23:59:59+09:00`)
        .limit(1)

      if (logs?.length) continue

      await sendPush(
        patient.push_token,
        '💊 약 드실 시간이에요',
        `${MEAL_LABELS[slot]} 약을 드실 시간이에요.`,
        { type: 'medication_reminder', mealTime: slot },
      )
      sent++
    }
  }

  return new Response(JSON.stringify({ sent, time: currentTime }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
