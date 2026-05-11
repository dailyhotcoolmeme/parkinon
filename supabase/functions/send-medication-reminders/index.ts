import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const MEAL_LABELS: Record<string, string> = {
  morning: '아침', lunch: '점심', dinner: '저녁', bedtime: '취침',
}

async function sendPush(to: string, title: string, body: string, data: Record<string, unknown>) {
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
      channelId: 'default',
    }),
  })
  const result = await res.json()
  console.log('[sendPush]', JSON.stringify({ to: to.slice(0, 30), title, status: res.status, result }))
}

function subtractMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = h * 60 + m - minutes
  const safeTotal = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(safeTotal / 60)).padStart(2, '0')}:${String(safeTotal % 60).padStart(2, '0')}`
}

async function logNotification(userId: string, type: string, title: string, body: string, data: Record<string, unknown>) {
  await supabase.from('notification_logs').insert({
    user_id: userId,
    type,
    title,
    body,
    data,
    read_at: null,
  })
}

async function hasTakenMed(patientId: string, slot: string, today: string): Promise<boolean> {
  const { data: logs } = await supabase
    .from('med_logs')
    .select('id')
    .eq('patient_id', patientId)
    .eq('meal_time', slot)
    .gte('taken_at', `${today}T00:00:00+09:00`)
    .lte('taken_at', `${today}T23:59:59+09:00`)
    .limit(1)
  return !!(logs?.length)
}

async function sendCaregiverMissed(patientId: string, patientGroupId: string, slot: string) {
  const { data: caregivers } = await supabase
    .from('patient_group_members')
    .select('user_id')
    .eq('group_id', patientGroupId)
    .eq('role', 'caregiver')

  if (!caregivers?.length) return

  const { data: patientUser } = await supabase
    .from('users')
    .select('name')
    .eq('id', patientId)
    .single()
  const patientName = patientUser?.name?.trim()
  const subject = patientName ? `${patientName}님` : '환자분'

  const { data: caregiverUsers } = await supabase
    .from('users')
    .select('push_token, caregiver_notif_prefs')
    .in('id', caregivers.map((c: any) => c.user_id))
    .not('push_token', 'is', null)

  for (const cu of caregiverUsers ?? []) {
    if (!cu.push_token) continue
    const prefs = (cu.caregiver_notif_prefs ?? {}) as Record<string, boolean>
    if (prefs.med_missed === false) continue
    await sendPush(
      cu.push_token,
      '⚠️ 약을 안 드셨어요',
      `${subject}이 ${MEAL_LABELS[slot]} 약을 아직 안 드셨어요.`,
      { type: 'caregiver_missed_med', mealTime: slot },
    )
  }
}

Deno.serve(async (_req: Request) => {
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const hh = String(kstNow.getHours()).padStart(2, '0')
  const mm = String(kstNow.getMinutes()).padStart(2, '0')
  const currentTime = `${hh}:${mm}`
  const time10 = subtractMinutes(currentTime, 10)
  const time20 = subtractMinutes(currentTime, 20)
  const today = kstNow.toISOString().split('T')[0]

  let sent = 0

  // ── 1. 정시 알림 ──────────────────────────────────────────────────
  const { data: matchedMeds } = await supabase.rpc('get_meds_at_time', { target_time: currentTime })

  if (matchedMeds?.length) {
    const toNotify: Map<string, Set<string>> = new Map()
    for (const row of matchedMeds) {
      if (!toNotify.has(row.patient_id)) toNotify.set(row.patient_id, new Set())
      toNotify.get(row.patient_id)!.add(row.meal_time)
    }

    for (const [patientId, slots] of toNotify.entries()) {
      const { data: patient } = await supabase
        .from('users')
        .select('push_token, notification_enabled, med_time_notif_prefs, patient_group_id')
        .eq('id', patientId)
        .single()

      if (!patient?.push_token || !patient.notification_enabled) continue

      const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>

      for (const slot of slots) {
        if (prefs[slot] === false) continue
        if (await hasTakenMed(patientId, slot, today)) continue

        await sendPush(
          patient.push_token,
          '💊 약 드실 시간이에요',
          `${MEAL_LABELS[slot]} 약을 드실 시간이에요.`,
          { type: 'medication_reminder', mealTime: slot },
        )
        await logNotification(patientId, 'medication_reminder', '💊 약 드실 시간이에요', `${MEAL_LABELS[slot]} 약을 드실 시간이에요.`, { type: 'medication_reminder', mealTime: slot })
        sent++
      }
    }
  }

  // ── 2. 1차 미복용 알림 (+10분) — 환자에게만 ───────────────────────
  const { data: meds10 } = await supabase.rpc('get_meds_at_time', { target_time: time10 })

  if (meds10?.length) {
    const toNotify10: Map<string, Set<string>> = new Map()
    for (const row of meds10) {
      if (!toNotify10.has(row.patient_id)) toNotify10.set(row.patient_id, new Set())
      toNotify10.get(row.patient_id)!.add(row.meal_time)
    }

    for (const [patientId, slots] of toNotify10.entries()) {
      const { data: patient } = await supabase
        .from('users')
        .select('push_token, notification_enabled, med_time_notif_prefs, patient_group_id')
        .eq('id', patientId)
        .single()

      if (!patient?.push_token || !patient.notification_enabled) continue

      const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>

      for (const slot of slots) {
        if (prefs[slot] === false) continue
        if (await hasTakenMed(patientId, slot, today)) continue

        await sendPush(
          patient.push_token,
          '💊 약을 아직 안 드셨어요',
          `${MEAL_LABELS[slot]} 약을 아직 드시지 않으셨어요.`,
          { type: 'missed_medication_first', mealTime: slot },
        )
        await logNotification(patientId, 'missed_medication', '💊 약을 아직 안 드셨어요', `${MEAL_LABELS[slot]} 약을 아직 드시지 않으셨어요.`, { type: 'missed_medication_first', mealTime: slot })
        sent++
      }
    }
  }

  // ── 3. 2차 미복용 알림 (+20분) — 환자 + 보호자 ───────────────────
  const { data: meds20 } = await supabase.rpc('get_meds_at_time', { target_time: time20 })

  if (meds20?.length) {
    const toNotify20: Map<string, Set<string>> = new Map()
    for (const row of meds20) {
      if (!toNotify20.has(row.patient_id)) toNotify20.set(row.patient_id, new Set())
      toNotify20.get(row.patient_id)!.add(row.meal_time)
    }

    for (const [patientId, slots] of toNotify20.entries()) {
      const { data: patient } = await supabase
        .from('users')
        .select('push_token, notification_enabled, med_time_notif_prefs, patient_group_id')
        .eq('id', patientId)
        .single()

      if (!patient?.notification_enabled) continue

      const prefs = (patient.med_time_notif_prefs ?? {}) as Record<string, boolean>

      for (const slot of slots) {
        if (prefs[slot] === false) continue
        if (await hasTakenMed(patientId, slot, today)) continue

        // 환자에게 2차 알림
        if (patient.push_token) {
          await sendPush(
            patient.push_token,
            '💊 약을 안 드셨어요',
            `${MEAL_LABELS[slot]} 약을 아직 안 드셨어요.`,
            { type: 'missed_medication_second', mealTime: slot },
          )
          await logNotification(patientId, 'missed_medication', '💊 약을 안 드셨어요', `${MEAL_LABELS[slot]} 약을 아직 안 드셨어요.`, { type: 'missed_medication_second', mealTime: slot })
          sent++
        }

        // 보호자에게 알림
        if (patient.patient_group_id) {
          await sendCaregiverMissed(patientId, patient.patient_group_id, slot)
        }
      }
    }
  }

  // ── 4. 운동 알림 ────────────────────────────────────────────────
  const { data: allPatients } = await supabase
    .from('users')
    .select('id, push_token, notification_enabled, exercise_notif_prefs')
    .eq('role', 'patient')
    .eq('notification_enabled', true)
    .not('push_token', 'is', null)

  for (const patient of allPatients ?? []) {
    if (!patient.push_token) continue
    const prefs = (patient.exercise_notif_prefs ?? []) as Array<{
      id: string; ampm: string; hour: number; minute: number; enabled: boolean
    }>
    for (const pref of prefs) {
      if (!pref.enabled) continue
      // ampm + hour → 24시간 KST HH:MM 변환
      let h = pref.hour
      if (pref.ampm === '오후' && h !== 12) h += 12
      if (pref.ampm === '오전' && h === 12) h = 0
      const target = `${String(h).padStart(2, '0')}:${String(pref.minute).padStart(2, '0')}`
      if (target !== currentTime) continue
      await sendPush(
        patient.push_token,
        '🏃 운동할 시간이에요!',
        '오늘 운동 기록을 남겨보세요.',
        { type: 'exercise_reminder' },
      )
      await logNotification(patient.id, 'exercise_reminder', '🏃 운동할 시간이에요!', '오늘 운동 기록을 남겨보세요.', { type: 'exercise_reminder' })
      sent++
    }
  }

  return new Response(JSON.stringify({ sent, time: currentTime, time10, time20 }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
