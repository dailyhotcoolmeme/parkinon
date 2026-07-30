/**
 * 서버 푸시 알림 다국어 (Edge Function 공용)
 *
 * 왜 만들었나:
 *   기존에는 함수마다 `const isEn = user.language === 'en'` 로 갈라 한국어/영어 문구를
 *   삼항으로 박아 넣었다. 이 구조는 두 가지가 문제였다.
 *     1) language='fr' 인 사용자는 isEn 이 false 라 한국어 알림을 받는다. 언어를 추가할수록
 *        조용히 한국어로 새는 사용자가 늘어난다.
 *     2) 문구 하나를 추가하려면 함수 8개에 걸쳐 xxxBody / xxxBodyEn 쌍을 계속 늘려야 한다.
 *
 *   이제 문구는 아래 STRINGS 한 곳에만 있고, 언어를 추가하려면 해당 언어 블록만 채우면 된다.
 *   함수 코드는 건드릴 필요가 없다.
 *
 * 폴백:
 *   요청 언어에 키가 없으면 영어 → 한국어 순으로 내려간다. 앱과 동일하게 "최악이라도 영어"다.
 *   (한국어를 최후 폴백으로 두는 이유: 국내 사용자는 language 가 null 인 경우가 있어
 *    resolveLang 이 'ko' 로 떨어지는데, 그때는 한국어가 나오는 게 맞다.)
 */

export type Lang = 'ko' | 'en' | 'fr' | 'ja';

const SUPPORTED: Lang[] = ['ko', 'en', 'fr', 'ja'];

/**
 * users.language 값을 지원 언어로 정규화.
 * null/미지원 언어는 'en'(해외 기본). 명시적으로 'ko' 인 경우만 한국어.
 * ⚠️ 과거 isEn 방식은 "en 이 아니면 전부 한국어"였다. 그 반대로 뒤집는다 —
 *    미지원 언어 사용자는 한국어보다 영어를 받는 게 낫다.
 */
export function resolveLang(raw: unknown): Lang {
  const s = String(raw ?? '').toLowerCase();
  if (!s) return 'ko'; // language 미설정 = 초기 국내 사용자
  const primary = s.split(/[-_]/)[0] as Lang;
  return SUPPORTED.includes(primary) ? primary : 'en';
}

type Dict = Record<string, string>;

/**
 * 알림 문구.
 *   {{name}} 형태의 자리표시자는 t() 의 vars 로 치환된다.
 *   새 언어 추가 = 아래에 블록 하나 추가. 함수 코드 수정 불필요.
 */
const STRINGS: Record<Lang, Dict> = {
  ko: {
    'med.time.title': '💊 약 드실 시간이에요',
    'med.time.body': '{{when}} 약 복용 시간이에요.',
    'med.time.bodyNoTime': '약 드실 시간이에요.',
    'med.missed.title': '💊 약을 아직 안 드셨어요',
    'med.missed.body': '아직 {{when}} 약을 드시지 않으셨어요.',
    'med.missed.bodyNoTime': '아직 약을 드시지 않으셨어요.',
    'med.missed.caregiverBody': '{{subject}}이 아직 {{when}} 약을 안 드셨어요. 약 드시도록 챙겨주세요.',
    'med.missed.caregiverBodyNoTime': '{{subject}}이 아직 약을 안 드셨어요. 약 드시도록 챙겨주세요.',
    'exercise.title': '🏃 운동할 시간이에요!',
    'exercise.body': '오늘 운동 기록을 남겨보세요.',
    'bodystate.title': '😊 몸 상태는 어때요?',
    'diary.title': '📔 {{author}}님이 가족 일기를 남겼어요',
    'diary.body': '가족 일기를 확인해보세요.',
    'diary.authorFallback': '가족',
    'family.joined.title': '👨‍👩‍👧 새 가족이 연결되었어요',
    'family.joined.body': '{{name}}님이 가족으로 연결되었어요.',
    'family.joined.bodyNoName': '새 가족이 연결되었어요.',
    'appointment.title': '🏥 진료 일정 알림',
    'measurement.title': '🖐️ {{name}}님이 컨디션 측정을 했어요',
    'measurement.body': '오늘 측정 결과를 확인해보세요.',
    'appointment.bodyWeek': '{{hospital}} 진료가 일주일 뒤예요.\n{{when}}',
    'appointment.bodyTomorrow': '{{hospital}} 진료가 내일이에요.\n{{when}}',
    'appointment.hospitalFallback': '진료',
    'bodystate.body': '{{when}} 드신 약의 {{interval}} 몸 상태를 기록해주세요.',
    'bodystate.bodyNoTime': '드신 약의 {{interval}} 몸 상태를 기록해주세요.',
    'bodystate.bodyImmediate': '{{when}} 약 드신 직후 몸 상태를 기록해주세요.',
    'bodystate.bodyImmediateNoTime': '약 드신 직후 몸 상태를 기록해주세요.',
    'interval.minutes': '{{n}}분 후',
    'interval.hours': '{{h}}시간 후',
    'interval.hoursMinutes': '{{h}}시간 {{m}}분 후',
    'patient.fallbackName': '환자분',
    'patient.honorific': '{{name}}님',
    // 문구의 {{when}} 앞부분에 들어가는 시간대 라벨.
    'period.dawn': '새벽',
    'period.morning': '아침',
    'period.midday': '점심',
    'period.afternoon': '오후',
    'period.evening': '저녁',
    'period.night': '밤',
    // 표준 4슬롯 라벨(사용자가 이름을 바꾸지 않은 기본 슬롯).
    'slot.morning': '아침',
    'slot.lunch': '점심',
    'slot.dinner': '저녁',
    'slot.bedtime': '취침',
    'clock.am': '오전',
    'clock.pm': '오후',
    'weekday.sun': '일',
    'weekday.mon': '월',
    'weekday.tue': '화',
    'weekday.wed': '수',
    'weekday.thu': '목',
    'weekday.fri': '금',
    'weekday.sat': '토',
    'appt.when': '{{month}}월 {{day}}일({{weekday}}) {{time}}',
  },
  en: {
    'med.time.title': '💊 Medication time',
    'med.time.body': '{{when}} — time to take your medication.',
    'med.time.bodyNoTime': 'Time to take your medication.',
    'med.missed.title': '💊 Missed dose',
    'med.missed.body': "You haven't taken your {{when}} medication yet.",
    'med.missed.bodyNoTime': "You haven't taken your medication yet.",
    'med.missed.caregiverBody': "{{subject}} hasn't taken their {{when}} medication yet. Please check in on them.",
    'med.missed.caregiverBodyNoTime': "{{subject}} hasn't taken their medication yet. Please check in on them.",
    'exercise.title': '🏃 Exercise time!',
    'exercise.body': 'Log your exercise for today.',
    'bodystate.title': '😊 How do you feel?',
    'diary.title': '📔 {{author}} wrote in the family diary',
    'diary.body': 'Tap to view the family diary.',
    'diary.authorFallback': 'A family member',
    'family.joined.title': '👨‍👩‍👧 New family member',
    'family.joined.body': '{{name}} is now linked to your family.',
    'family.joined.bodyNoName': 'A new family member is now linked.',
    'appointment.title': '🏥 Appointment reminder',
    'measurement.title': '🖐️ {{name}} did a condition measurement',
    'measurement.body': "Check today's measurement results.",
    'appointment.bodyWeek': '{{hospital}} is in 1 week.\n{{when}}',
    'appointment.bodyTomorrow': '{{hospital}} is tomorrow.\n{{when}}',
    'appointment.hospitalFallback': 'your appointment',
    'bodystate.body': '{{when}} — Record your body state {{interval}} taking your medication.',
    'bodystate.bodyNoTime': 'Record your body state {{interval}} taking your medication.',
    'bodystate.bodyImmediate': '{{when}} — Record your body state right after taking your medication.',
    'bodystate.bodyImmediateNoTime': 'Record your body state right after taking your medication.',
    'interval.minutes': '{{n}} minutes after',
    'interval.hours': '{{h}} hours after',
    'interval.hoursMinutes': '{{h}} hours {{m}} minutes after',
    'patient.fallbackName': 'The patient',
    'patient.honorific': '{{name}}',
    'period.dawn': 'Early morning',
    'period.morning': 'Morning',
    'period.midday': 'Midday',
    'period.afternoon': 'Afternoon',
    'period.evening': 'Evening',
    'period.night': 'Night',
    'slot.morning': 'Morning',
    'slot.lunch': 'Lunch',
    'slot.dinner': 'Dinner',
    'slot.bedtime': 'Bedtime',
    'clock.am': 'AM',
    'clock.pm': 'PM',
    'weekday.sun': 'Sun',
    'weekday.mon': 'Mon',
    'weekday.tue': 'Tue',
    'weekday.wed': 'Wed',
    'weekday.thu': 'Thu',
    'weekday.fri': 'Fri',
    'weekday.sat': 'Sat',
    'appt.when': '{{weekday}}, {{month}}/{{day}} {{time}}',
  },
  fr: {
    'med.time.title': '💊 C\'est l\'heure de votre médicament',
    'med.time.body': '{{when}} — c\'est l\'heure de prendre votre médicament.',
    'med.time.bodyNoTime': 'C\'est l\'heure de prendre votre médicament.',
    'med.missed.title': '💊 Prise oubliée',
    'med.missed.body': 'Vous n\'avez pas encore pris votre médicament {{when}}.',
    'med.missed.bodyNoTime': 'Vous n\'avez pas encore pris votre médicament.',
    'med.missed.caregiverBody': '{{subject}} n\'a pas encore pris son médicament {{when}}. Pensez à le lui rappeler.',
    'med.missed.caregiverBodyNoTime': '{{subject}} n\'a pas encore pris son médicament. Pensez à le lui rappeler.',
    'exercise.title': '🏃 C\'est l\'heure de bouger !',
    'exercise.body': 'Notez votre activité du jour.',
    'bodystate.title': '😊 Comment vous sentez-vous ?',
    'diary.title': '📔 {{author}} a écrit dans le journal familial',
    'diary.body': 'Touchez pour lire le journal familial.',
    'diary.authorFallback': 'Un proche',
    'family.joined.title': '👨‍👩‍👧 Nouveau membre de la famille',
    'family.joined.body': '{{name}} est maintenant lié à votre famille.',
    'family.joined.bodyNoName': 'Un nouveau membre est maintenant lié à votre famille.',
    'appointment.title': '🏥 Rappel de rendez-vous',
    'measurement.title': '🖐️ {{name}} a fait une mesure de son état',
    'measurement.body': 'Consultez les résultats du jour.',
    'appointment.bodyWeek': '{{hospital}} dans une semaine.\n{{when}}',
    'appointment.bodyTomorrow': '{{hospital}} demain.\n{{when}}',
    'appointment.hospitalFallback': 'Votre rendez-vous',
    'bodystate.body': '{{when}} — notez votre état {{interval}} la prise de votre médicament.',
    'bodystate.bodyNoTime': 'Notez votre état {{interval}} la prise de votre médicament.',
    'bodystate.bodyImmediate': '{{when}} — notez votre état juste après la prise de votre médicament.',
    'bodystate.bodyImmediateNoTime': 'Notez votre état juste après la prise de votre médicament.',
    'interval.minutes': '{{n}} minutes après',
    'interval.hours': '{{h}} heures après',
    'interval.hoursMinutes': '{{h}} heures {{m}} minutes après',
    'patient.fallbackName': 'Le patient',
    'patient.honorific': '{{name}}',
    'period.dawn': 'Petit matin',
    'period.morning': 'Matin',
    'period.midday': 'Midi',
    'period.afternoon': 'Après-midi',
    'period.evening': 'Soir',
    'period.night': 'Nuit',
    'slot.morning': 'Matin',
    'slot.lunch': 'Midi',
    'slot.dinner': 'Soir',
    'slot.bedtime': 'Coucher',
    'clock.am': '',
    'clock.pm': '',
    'weekday.sun': 'dim.',
    'weekday.mon': 'lun.',
    'weekday.tue': 'mar.',
    'weekday.wed': 'mer.',
    'weekday.thu': 'jeu.',
    'weekday.fri': 'ven.',
    'weekday.sat': 'sam.',
    'appt.when': '{{weekday}} {{day}}/{{month}} {{time}}',
  },
  ja: {
    'med.time.title': '💊 お薬の時間です',
    'med.time.body': '{{when}}のお薬の時間です。',
    'med.time.bodyNoTime': 'お薬の時間です。',
    'med.missed.title': '💊 お薬がまだです',
    'med.missed.body': '{{when}}のお薬をまだ飲んでいません。',
    'med.missed.bodyNoTime': 'お薬をまだ飲んでいません。',
    'med.missed.caregiverBody': '{{subject}}が{{when}}のお薬をまだ飲んでいません。声をかけてあげてください。',
    'med.missed.caregiverBodyNoTime': '{{subject}}がお薬をまだ飲んでいません。声をかけてあげてください。',
    'exercise.title': '🏃 運動の時間です！',
    'exercise.body': '今日の運動を記録してみましょう。',
    'bodystate.title': '😊 体調はいかがですか？',
    'diary.title': '📔 {{author}}さんが家族日記を書きました',
    'diary.body': '家族日記を確認してみましょう。',
    'diary.authorFallback': 'ご家族',
    'family.joined.title': '👨‍👩‍👧 新しい家族が連携しました',
    'family.joined.body': '{{name}}さんが家族として連携しました。',
    'family.joined.bodyNoName': '新しい家族が連携しました。',
    'appointment.title': '🏥 受診予定のお知らせ',
    'measurement.title': '🖐️ {{name}}さんが体調を測定しました',
    'measurement.body': '今日の測定結果を確認してみましょう。',
    'appointment.bodyWeek': '{{hospital}}の受診が1週間後です。\n{{when}}',
    'appointment.bodyTomorrow': '{{hospital}}の受診は明日です。\n{{when}}',
    'appointment.hospitalFallback': '受診',
    'bodystate.body': '{{when}}に飲んだお薬の、{{interval}}の体調を記録してください。',
    'bodystate.bodyNoTime': '飲んだお薬の、{{interval}}の体調を記録してください。',
    'bodystate.bodyImmediate': '{{when}}のお薬を飲んだ直後の体調を記録してください。',
    'bodystate.bodyImmediateNoTime': 'お薬を飲んだ直後の体調を記録してください。',
    'interval.minutes': '{{n}}分後',
    'interval.hours': '{{h}}時間後',
    'interval.hoursMinutes': '{{h}}時間{{m}}分後',
    'patient.fallbackName': '患者さん',
    'patient.honorific': '{{name}}さん',
    'period.dawn': '早朝',
    'period.morning': '朝',
    'period.midday': '昼',
    'period.afternoon': '午後',
    'period.evening': '夕方',
    'period.night': '夜',
    'slot.morning': '朝',
    'slot.lunch': '昼',
    'slot.dinner': '夕',
    'slot.bedtime': '就寝前',
    'clock.am': '午前',
    'clock.pm': '午後',
    'weekday.sun': '日',
    'weekday.mon': '月',
    'weekday.tue': '火',
    'weekday.wed': '水',
    'weekday.thu': '木',
    'weekday.fri': '金',
    'weekday.sat': '土',
    'appt.when': '{{month}}月{{day}}日（{{weekday}}） {{time}}',
  },
};

/** 시각(HH:MM)으로 시간대 키를 고른다. 문구는 t(lang, key) 로 꺼낸다. */
export function periodKeyFor(time: string | null | undefined): string | null {
  if (!time) return null;
  const h = parseInt(String(time).split(':')[0] ?? '', 10);
  if (Number.isNaN(h)) return null;
  if (h < 6) return 'period.dawn';
  if (h < 11) return 'period.morning';
  if (h < 13) return 'period.midday';
  if (h < 17) return 'period.afternoon';
  if (h < 21) return 'period.evening';
  return 'period.night';
}

/** 언어별 문구를 꺼내 자리표시자를 치환한다. 없는 키는 en → ko 순으로 폴백. */
export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? STRINGS.ko[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => String(vars[name] ?? ''));
}

/** 번역 누락 점검용 — 배포 스크립트에서 호출해 비어 있는 언어를 잡는다. */
export function missingKeys(lang: Lang): string[] {
  const base = Object.keys(STRINGS.ko);
  const target = STRINGS[lang] ?? {};
  return base.filter((k) => !target[k]);
}

/** 약효 추적 간격(분) → 언어별 라벨. 예: 30 → '30분 후' / '30 minutes after'. */
export function intervalLabel(lang: Lang, minutes: number): string {
  if (minutes < 60) return t(lang, 'interval.minutes', { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0
    ? t(lang, 'interval.hours', { h })
    : t(lang, 'interval.hoursMinutes', { h, m });
}

/**
 * 시각(HH:MM[:SS])을 언어별 표기로. ko '오전 8:10' / en '8:10 AM' / fr '08:10' / ja '午前8:10'.
 * 서버는 Intl 없이 돌아야 하므로 직접 만든다(Edge 런타임 로케일 데이터에 기대지 않는다).
 */
export function formatClock(lang: Lang, time: string | null | undefined): string {
  if (!time) return '';
  const parts = String(time).split(':');
  const h = parseInt(parts[0] ?? '', 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h)) return String(time);
  const mm = String(Number.isNaN(m) ? 0 : m).padStart(2, '0');
  if (lang === 'fr') return `${String(h).padStart(2, '0')}:${mm}`;
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const meridiem = t(lang, h < 12 ? 'clock.am' : 'clock.pm');
  if (lang === 'en') return `${h12}:${mm} ${meridiem}`;
  return `${meridiem} ${h12}:${mm}`; // ko·ja 는 오전/午前 이 앞에 온다
}

/**
 * 복용 시간대 표시명. **DB 의 label(한글) 을 쓰지 않는다** — legacy_key 또는 시각에서 만든다.
 * (2026-07-30 오너 확정: 시스템 표시값은 키로 저장하고 표시명은 번역표에서 꺼낸다.)
 */
export function slotLabel(lang: Lang, legacyKey: string | null | undefined, time: string | null | undefined): string {
  const key = String(legacyKey ?? '').trim();
  if (key === 'morning' || key === 'lunch' || key === 'dinner' || key === 'bedtime') {
    return t(lang, `slot.${key}`);
  }
  const pk = periodKeyFor(time);
  return pk ? t(lang, pk) : '';
}

/** '{시간대} {시각}' 표기. 예 ko '저녁 오후 6:00' / fr 'Soir 18:00'. */
export function slotLabelWithTime(lang: Lang, legacyKey: string | null | undefined, time: string | null | undefined): string {
  const label = slotLabel(lang, legacyKey, time);
  const clock = formatClock(lang, time);
  return [label, clock].filter(Boolean).join(' ');
}

/** 요일 짧은 이름. 0=일요일. */
export function weekdayShort(lang: Lang, dowIndex: number): string {
  const keys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return t(lang, `weekday.${keys[dowIndex] ?? 'sun'}`);
}
