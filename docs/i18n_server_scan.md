서버 한글 코드줄 177건

══════ 기타 (71)
  change-role/index.ts:47  stats.errors.push('R2 환경변수 누락 — 객체 삭제 건너뜀')
  claude-medical-record/index.ts:66  {"medications":[{"name":"약 이름","dosage":"용량 또는 빈 문자열"}]}
  claude-medical-record/index.ts:79  - 1회 복용량(예: "1정", "1포", "2캡슐", "5mg", "10mL" 등)이 처방전/약봉투에 명확히 표시된 경우 그대로 dosage에 채우세요.
  claude-medical-record/index.ts:80  - 보통 처방전의 "1회 투약량" 컬럼 또는 약봉투의 1회 복용량에 표기됩니다.
  claude-medical-record/index.ts:84  - 처방전/약봉투에 "1일 3회", "1일 투여횟수 3", "1일 3번", "하루 2회" 등으로 표시된 1일 복용 횟수를 정수로 추출하세요. 예: "1일 3회" → 3.
  claude-medical-record/index.ts:85  - 보통 처방전의 "1일투여량/투여횟수" 또는 "투약 횟수" 컬럼에 있습니다.
  claude-medical-record/index.ts:91  - 보통 약품명 옆에 "EDI코드" 또는 "코드" 컬럼에 표기됩니다.
  claude-medical-record/index.ts:96  {"medications":[{"name":"약 이름","ediCode":"664601180","dosage":"1정","dailyCount":3,"times":["morning","lunch","
  claude-medical-record/index.ts:207  return new Response(JSON.stringify({ error: '처방전 분석에 실패했어요.' }), {
  claude-medical-record/index.ts:272  return new Response(JSON.stringify({ error: '처방전 분석 중 오류가 발생했어요.' }), {
  convert-sound-caf/index.ts:97  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return json({ error: 'R2 환경변수 미설정' }, 500);
  delete-account/index.ts:32  stats.errors.push('R2 환경변수 누락 — 객체 삭제 건너뜀')
  delete-account/index.ts:39  stats.errors.push('user_id 형식 비정상 — 객체 삭제 중단')
  delete-r2-file/index.ts:101  JSON.stringify({ error: '삭제 권한이 없습니다.' }),
  delete-r2-file/index.ts:132  JSON.stringify({ error: 'DB 삭제에 실패했습니다.' }),
  delete-r2-file/index.ts:145  JSON.stringify({ error: '삭제 중 오류가 발생했습니다.' }),
  kakao-auth/index.ts:27  throw new Error(`카카오 토큰 정보 조회 실패: ${tokenInfoRes.status} ${text}`);
  kakao-auth/index.ts:40  throw new Error(`카카오 토큰 검증 실패: ${kakaoRes.status} ${text}`);
  mfds-proxy/index.ts:161  return new Response(JSON.stringify({ error: '식약처 API 호출에 실패했어요.' }), {
  mfds-proxy/index.ts:174  return new Response(JSON.stringify({ error: '식약처 정보 조회 중 오류가 발생했어요.' }), {
  notify-measurement-completed/index.ts:187  const patientName = patientRow?.name ?? '환자분';
  ocr-prescription/index.ts:21  replacement: '[주소 마스킹]',
  ocr-prescription/index.ts:83  throw new Error('CLAUDE_API_KEY 환경변수가 설정되지 않았습니다.');
  ocr-prescription/index.ts:95  {"medications": [{"name": "약이름", "dosage": "1정/500mg 등 용량", "meal_times": ["morning","lunch","dinner"]}]}
  ocr-prescription/index.ts:130  throw new Error(`Claude API 오류: ${response.status} - ${errorText}`);
  ocr-prescription/index.ts:237  JSON.stringify({ error: '처방전 분석 중 오류가 발생했습니다.' }),
  process-notification-queue/index.ts:12  morning: '아침',
  process-notification-queue/index.ts:13  lunch: '점심',
  process-notification-queue/index.ts:14  dinner: '저녁',
  process-notification-queue/index.ts:15  bedtime: '취침',
  process-notification-queue/index.ts:39  if (h < 6) return '새벽'
  process-notification-queue/index.ts:40  if (h < 11) return '아침'
  process-notification-queue/index.ts:41  if (h < 13) return '점심'
  process-notification-queue/index.ts:42  if (h < 17) return '오후'
  process-notification-queue/index.ts:43  if (h < 21) return '저녁'
  process-notification-queue/index.ts:44  return '밤'
  r2-get-url/index.ts:203  return json({ error: '해당 미디어를 열람할 권한이 없습니다.' }, 403);
  r2-get-url/index.ts:232  return json({ error: 'presigned GET URL 발급 실패' }, 500);
  r2-upload/index.ts:116  JSON.stringify({ error: '허용되지 않는 contentType 입니다.' }),
  r2-upload/index.ts:140  JSON.stringify({ error: '허용되지 않는 contentType 입니다.' }),
  r2-upload/index.ts:152  JSON.stringify({ error: '본인 경로에만 업로드할 수 있습니다.' }),
  r2-upload/index.ts:160  JSON.stringify({ error: '해당 경로에 업로드할 권한이 없습니다.' }),
  r2-upload/index.ts:224  JSON.stringify({ error: '오늘 업로드 한도를 모두 사용했습니다.', code: 'QUOTA_EXCEEDED' }),
  r2-upload/index.ts:267  JSON.stringify({ error: 'presigned URL 발급 실패' }),
  send-appointment-reminders/index.ts:15  const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토']
  send-appointment-reminders/index.ts:49  const ampm = hour < 12 ? '오전' : '오후'
  send-appointment-reminders/index.ts:52  return `${mo}월 ${day}일(${dow}) ${ampm} ${h12}:${String(minute).padStart(2, '0')}`
  send-medication-reminders/index.ts:11  morning: '아침', lunch: '점심', dinner: '저녁', bedtime: '취침',
  send-medication-reminders/index.ts:23  const STANDARD_LABELS = new Set(['아침', '점심', '저녁', '취침'])
  send-medication-reminders/index.ts:34  if (h < 6) return '새벽'
  send-medication-reminders/index.ts:35  if (h < 11) return '아침'
  send-medication-reminders/index.ts:36  if (h < 13) return '점심'
  send-medication-reminders/index.ts:37  if (h < 17) return '오후'
  send-medication-reminders/index.ts:38  if (h < 21) return '저녁'
  send-medication-reminders/index.ts:39  return '밤'
  send-medication-reminders/index.ts:110  const period = h < 12 ? '오전' : '오후'
  send-medication-reminders/index.ts:786  if (pref.ampm === '오후' && h !== 12) h += 12
  send-medication-reminders/index.ts:787  if (pref.ampm === '오전' && h === 12) h = 0
  send-missed-med-reminders/index.ts:11  morning: '아침',
  send-missed-med-reminders/index.ts:12  lunch: '점심',
  send-missed-med-reminders/index.ts:13  dinner: '저녁',
  send-missed-med-reminders/index.ts:14  bedtime: '취침',
  send-missed-med-reminders/index.ts:24  const STANDARD_LABELS = new Set(['아침', '점심', '저녁', '취침'])
  send-missed-med-reminders/index.ts:38  if (h < 6) return '새벽'
  send-missed-med-reminders/index.ts:39  if (h < 11) return '아침'
  send-missed-med-reminders/index.ts:40  if (h < 13) return '점심'
  send-missed-med-reminders/index.ts:41  if (h < 17) return '오후'
  send-missed-med-reminders/index.ts:42  if (h < 21) return '저녁'
  send-missed-med-reminders/index.ts:43  return '밤'
  send-push/index.ts:93  JSON.stringify({ error: '알 수 없는 수신자 토큰입니다.' }),
  send-push/index.ts:106  JSON.stringify({ error: '해당 수신자에게 알림을 보낼 권한이 없습니다.' }),
══════ 콘솔로그 (45)
  change-role/index.ts:134  console.log(`[change-role] R2 정리 user=${user.id}:`, JSON.stringify(r2Stats))
  change-role/index.ts:143  console.error('[change-role] RPC 오류:', error)
  change-role/index.ts:155  console.error('[change-role] 오류:', e)
  claude-medical-record/index.ts:206  console.error('Claude API 오류:', apiRes.status, errText);
  claude-medical-record/index.ts:230  console.error('JSON 파싱 실패:', e);
  claude-medical-record/index.ts:271  console.error('claude-medical-record 처리 오류:', err);
  delete-account/index.ts:151  console.log(`[delete-account] R2 정리 결과 user=${user.id}:`, JSON.stringify(r2Stats))
  delete-account/index.ts:154  console.error('[delete-account] R2 정리 예외:', e)
  delete-account/index.ts:182  console.error('[delete-account] 오류:', e)
  delete-r2-file/index.ts:130  console.error('media_logs 삭제 오류:', deleteError);
  kakao-auth/index.ts:123  console.error('[kakao-auth] 오류:', err?.message || err);
  mfds-proxy/index.ts:160  console.error('MFDS upstream 오류:', upstream.status, text.slice(0, 200));
  mfds-proxy/index.ts:173  console.error('mfds-proxy 오류:', err);
  notify-diary-entry/index.ts:104  console.warn('[notify-diary-entry] logNotification 실패:', e);
  notify-family-joined/index.ts:61  console.warn('[notify-family-joined] logNotification 실패:', e);
  notify-measurement-completed/index.ts:95  console.warn('[notify-measurement-completed] logNotification 실패:', e);
  notify-measurement-completed/index.ts:138  console.error('[notify-measurement-completed] measurement 조회 오류:', mErr);
  notify-measurement-completed/index.ts:177  console.error('[notify-measurement-completed] patient 조회 오류:', pErr);
  notify-measurement-completed/index.ts:209  console.error('[notify-measurement-completed] group_members 조회 오류:', gmErr);
  notify-measurement-completed/index.ts:240  console.error('[notify-measurement-completed] caregiver users 조회 오류:', cuErr);
  ocr-prescription/index.ts:138  console.error('Claude 응답에서 JSON을 찾을 수 없음');
  ocr-prescription/index.ts:235  console.error('OCR 처리 오류:', error);
  process-notification-queue/index.ts:257  console.log('[process-queue] 이미 처리된 항목 건너뜀:', item.id)
  process-notification-queue/index.ts:274  console.log('[process-queue] 비활성/추적OFF/삭제 슬롯 — 발송 스킵(sent_at 유지):', item.id, item.dose_slot_id)
  process-notification-queue/index.ts:283  console.log('[process-queue] 전체 알림 OFF — 발송 스킵(sent_at 유지):', item.id)
  process-notification-queue/index.ts:315  console.log('[process-queue] 안드 알람처럼 — 서버 미발송(로컬 담당·sent_at 유지):', item.id)
  process-notification-queue/index.ts:344  console.error('[process-queue] push 실패 — sent_at 초기화, 재시도 대기:', item.id)
  queue-effect-tracking/index.ts:189  console.warn('[queue-effect-tracking] (dose_slot) 중복 큐 무시(동시 더블탭, 23505):', insertError.message)
  queue-effect-tracking/index.ts:195  console.error('[queue-effect-tracking] (dose_slot) INSERT 오류:', insertError)
  queue-effect-tracking/index.ts:250  console.error('[queue-effect-tracking] INSERT 오류:', insertError)
  queue-effect-tracking/index.ts:262  console.error('[queue-effect-tracking] 예외:', e)
  reconcile-refunds/index.ts:79  console.error('[reconcile-refunds] 토큰 발급 실패:', await r.text())
  reconcile-refunds/index.ts:171  console.error('[reconcile-refunds] reset_group_custom_sounds 실패:', g.id, e)
  reconcile-refunds/index.ts:214  console.error('[reconcile-refunds] 조회 실패:', error)
  reconcile-refunds/index.ts:239  console.error('[reconcile-refunds] reset_group_custom_sounds 실패:', gid, e)
  revenuecat-webhook/index.ts:89  console.error('[revenuecat-webhook] 그룹 확보 실패:', error)
  revenuecat-webhook/index.ts:129  console.error('[revenuecat-webhook] 이벤트 로그 실패:', e)
  revenuecat-webhook/index.ts:297  console.error('[revenuecat-webhook] reset_group_custom_sounds 실패:', e)
  revenuecat-webhook/index.ts:339  console.error('[revenuecat-webhook] reset_group_custom_sounds 실패:', e)
  revenuecat-webhook/index.ts:375  console.error('[revenuecat-webhook] reset_group_custom_sounds 실패:', e)
  save-push-token/index.ts:63  console.error('[save-push-token] DB 저장 실패:', error)
  save-push-token/index.ts:70  console.log('[save-push-token] push_token 저장 성공 — user:', user.id)
  sync-subscription/index.ts:65  console.error('[sync-subscription] 그룹 확보 실패:', error)
  sync-subscription/index.ts:87  console.error('[sync-subscription] RevenueCat 조회 실패:', e)
  sync-subscription/index.ts:114  console.error('[sync-subscription] 그룹 갱신 실패:', upErr)
══════ i18n표(정상) (41)
  (_shared/i18n.ts 의 ko 블록 — 언어별 표라 정상)
══════ 푸시/메시지 (17)
  claude-medical-record/index.ts:153  return new Response(JSON.stringify({ error: 'image_base64와 image_type이 필요합니다.' }), {
  claude-medical-record/index.ts:159  return new Response(JSON.stringify({ error: 'image_type은 jpeg 또는 png만 허용됩니다.' }), {
  claude-medical-record/index.ts:166  return new Response(JSON.stringify({ error: '이미지가 너무 큽니다.' }), {
  convert-sound-caf/index.ts:110  message: 'caf 변환 엔진 미확정(ffmpeg.wasm Edge 미지원). 다운로드까지 정상.',
  kakao-auth/index.ts:61  if (lookupErr) throw new Error(`users 조회 오류: ${lookupErr.message}`);
  kakao-auth/index.ts:71  throw new Error(`auth user 조회 실패: ${getUserErr?.message ?? 'email 없음'}`);
  kakao-auth/index.ts:90  throw new Error(`auth user 생성 실패: ${createErr.message}`);
  kakao-auth/index.ts:106  throw new Error(`public.users insert 실패: ${insertErr.message}`);
  kakao-auth/index.ts:116  if (linkErr) throw new Error(`magic link 생성 실패: ${linkErr.message}`);
  mfds-proxy/index.ts:122  return new Response(JSON.stringify({ error: '잘못된 endpoint 값입니다.' }), {
  mfds-proxy/index.ts:130  return new Response(JSON.stringify({ error: 'query 값이 비어있거나 너무 깁니다.' }), {
  ocr-prescription/index.ts:206  JSON.stringify({ error: 'image_base64와 image_type이 필요합니다.' }),
  ocr-prescription/index.ts:213  JSON.stringify({ error: 'image_type은 jpeg 또는 png만 허용됩니다.' }),
  ocr-prescription/index.ts:221  JSON.stringify({ error: '이미지가 너무 큽니다.' }),
  process-notification-queue/index.ts:29  const STANDARD_LABELS = new Set(['아침', '점심', '저녁', '취침'])
  send-medication-reminders/index.ts:229  '약'
  send-push/index.ts:170  JSON.stringify({ error: err.message ?? '전송 실패' }),
══════ 푸시 대상 호칭 (3)
  send-medication-reminders/index.ts:476  const subject = patientName ? `${patientName}님` : '환자분'
  send-missed-med-reminders/index.ts:281  const subject = patientName ? `${patientName}님` : '환자분'
  send-missed-med-reminders/index.ts:384  const subject = patientName ? `${patientName}님` : '환자분'
