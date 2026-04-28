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

async function sendPush(to: string, title: string, body: string, data: Record<string, unknown>): Promise<boolean> {
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
  const ok = result?.data?.status === 'ok'
  console.log('[process-queue sendPush]', JSON.stringify({ to: to.slice(0, 30), status: result?.data?.status, result }))
  return ok
}

Deno.serve(async (_req: Request) => {
  const now = new Date()

  const { data: pending } = await supabase
    .from('effect_tracking_queue')
    .select('*')
    .lte('send_at', now.toISOString())
    .is('sent_at', null)
    .limit(100)

  if (!pending?.length) {
    return new Response(JSON.stringify({ processed: 0 }), { headers: { 'Content-Type': 'application/json' } })
  }

  let processed = 0

  for (const item of pending) {
    const label = INTERVAL_LABELS[item.interval_minutes] ?? `${item.interval_minutes}분 후`

    const ok = await sendPush(
      item.push_token,
      '😊 몸 상태는 어때요?',
      `약 복용 ${label} 몸 상태를 기록해보세요.`,
      { type: 'effect_tracking', minutes: item.interval_minutes },
    )

    if (ok) {
      await supabase
        .from('effect_tracking_queue')
        .update({ sent_at: now.toISOString() })
        .eq('id', item.id)
      await supabase.from('notification_logs').insert({
        user_id: item.patient_id,
        type: 'effect_tracking',
        title: '😊 몸 상태는 어때요?',
        body: `약 복용 ${label} 몸 상태를 기록해보세요.`,
        data: { type: 'effect_tracking', minutes: item.interval_minutes },
        read_at: null,
      })
      processed++
    } else {
      console.error('[process-queue] push 실패 — sent_at 미설정, 재시도 대기:', item.id)
    }
  }

  return new Response(JSON.stringify({ processed }), { headers: { 'Content-Type': 'application/json' } })
})
