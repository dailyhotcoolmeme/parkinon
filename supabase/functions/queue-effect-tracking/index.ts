import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  try {
    // JWT 검증 (anon client로 getUser 호출)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await anonClient.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 요청 바디 파싱
    // 구(legacy): { patient_id, push_token, meal_time, notif_settings }
    // 신(dose_slot): { patient_id, push_token, dose_slot_id, med_log_id, notif_settings }
    const { patient_id, push_token, meal_time, dose_slot_id, med_log_id, notif_settings } = await req.json()

    if (!patient_id || !push_token || !Array.isArray(notif_settings)) {
      return new Response(JSON.stringify({ error: 'Invalid request body' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // service_role 클라이언트 (DB 쓰기)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // 권한 가드(양 경로 공통): 호출자 본인이거나, 환자와 같은 그룹의 멤버(보호자 대리 입력)만 허용.
    //  → 임의 patient_id 로 타 환자의 약효추적 큐를 생성/삭제하는 IDOR 차단.
    if (patient_id !== user.id) {
      const { data: patientRow } = await serviceClient
        .from('users')
        .select('patient_group_id')
        .eq('id', patient_id)
        .maybeSingle()
      const gid = patientRow?.patient_group_id ?? null
      let allowed = false
      if (gid) {
        const { data: membership } = await serviceClient
          .from('patient_group_members')
          .select('user_id')
          .eq('group_id', gid)
          .eq('user_id', user.id)
          .maybeSingle()
        allowed = !!membership
      }
      if (!allowed) {
        return new Response(JSON.stringify({ error: 'not authorized for this patient' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    const now = Date.now()

    // enabled: true 이고 minutes > 0 인 항목만 처리 (양 경로 공통)
    const validItems = (notif_settings as Array<{ minutes: number; enabled: boolean; soundId?: string | null }>)
      .filter((n) => n.enabled && n.minutes > 0)

    // 부분쓰기 방어: dose_slot_id가 오면 med_log_id도 반드시 필요.
    // (dose_slot_id만 있고 med_log_id가 없으면 legacy 경로로 새지 않도록 명시 거부)
    if (dose_slot_id && !med_log_id) {
      return new Response(JSON.stringify({ error: 'med_log_id required when dose_slot_id is present' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ============================================================
    // 신규 경로: dose_slot_id + med_log_id (복용 1건 1:1)
    //  - track_enabled로 통제 (bedtime 하드제외 분기 없음)
    //  - 중복제거는 med_log_id 1:1
    //  - send_at은 자르지 않음(소프트 경고 정책 — 사용자 선택 존중)
    // ============================================================
    if (dose_slot_id && med_log_id) {
      // 슬롯 조회: track_enabled 게이트
      const { data: slot } = await serviceClient
        .from('dose_slots')
        .select('id, patient_id, track_enabled, is_active')
        .eq('id', dose_slot_id)
        .maybeSingle()

      // cross-patient 가드: 슬롯 소유자(slot.patient_id)와 요청 바디 patient_id 불일치 시 403
      // (send-missed-med-reminders의 안전 패턴: 신뢰 출처는 slot.patient_id)
      if (slot && slot.patient_id !== patient_id) {
        return new Response(JSON.stringify({ error: 'patient_id mismatch with dose_slot owner' }), {
          status: 403,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // 슬롯이 없거나 비활성/추적꺼짐이면 큐잉하지 않음(기존 큐도 정리)
      if (!slot || !slot.is_active || slot.track_enabled === false) {
        await serviceClient
          .from('effect_tracking_queue')
          .delete()
          .eq('med_log_id', med_log_id)
          .is('sent_at', null)
        return new Response(JSON.stringify({ queued: 0, skipped: 'track disabled' }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      // 중복제거: 같은 med_log_id의 미발송 항목 삭제(복용 1건 = 큐 1세트)
      await serviceClient
        .from('effect_tracking_queue')
        .delete()
        .eq('med_log_id', med_log_id)
        .is('sent_at', null)

      if (validItems.length === 0) {
        return new Response(JSON.stringify({ queued: 0 }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      const rows = validItems.map((n) => ({
        patient_id: slot.patient_id,    // 요청 바디 값이 아니라 검증된 슬롯 소유자로 고정
        push_token,
        meal_time: meal_time ?? null,   // 호환용으로 같이 보관(있으면)
        dose_slot_id,
        med_log_id,
        interval_minutes: n.minutes,
        send_at: new Date(now + n.minutes * 60 * 1000).toISOString(),
        sent_at: null,
        // sound_id(uuid, custom_sounds FK)는 신규 경로에선 null로 두고,
        // 표시 채널/라벨은 process-notification-queue가 dose_slot join으로 해석.
      }))

      const { error: insertError } = await serviceClient
        .from('effect_tracking_queue')
        .insert(rows)

      if (insertError) {
        console.error('[queue-effect-tracking] (dose_slot) INSERT 오류:', insertError)
        return new Response(JSON.stringify({ error: insertError.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ queued: rows.length, path: 'dose_slot' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // ============================================================
    // 구 경로 (legacy, 100% 보존): meal_time 기준
    // ============================================================

    // 취침약은 약효 추적 알림 없음 (야간 수면 방해 방지) — legacy 동작 그대로
    if (meal_time === 'bedtime') {
      return new Response(JSON.stringify({ queued: 0, skipped: 'bedtime' }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 같은 meal_time의 미발송 항목만 삭제 (다른 식사의 추적 알림은 유지)
    await serviceClient
      .from('effect_tracking_queue')
      .delete()
      .eq('patient_id', patient_id)
      .eq('meal_time', meal_time)
      .is('sent_at', null)

    if (validItems.length === 0) {
      return new Response(JSON.stringify({ queued: 0 }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const rows = validItems.map((n) => ({
      patient_id,
      push_token,
      meal_time: meal_time ?? null,
      interval_minutes: n.minutes,
      send_at: new Date(now + n.minutes * 60 * 1000).toISOString(),
      sent_at: null,
      sound_id: n.soundId ?? null, // 이 약효 알림 항목에 지정된 목소리
    }))

    const { error: insertError } = await serviceClient
      .from('effect_tracking_queue')
      .insert(rows)

    if (insertError) {
      console.error('[queue-effect-tracking] INSERT 오류:', insertError)
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ queued: rows.length }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[queue-effect-tracking] 예외:', e)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
