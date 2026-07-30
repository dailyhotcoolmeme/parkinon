// exercise_logs.exercise_type 은 기록 당시 로케일로 "번역된 라벨 문자열"이 그대로 저장된다
// (안정적 id가 아님 — ExerciseRecordScreen 이 navigation params 로 t(label) 결과를 넘겨 저장).
// 그래서 영어 로케일로 기록한 뒤 한국어로 바꿔도 과거 기록은 기록 당시 언어 그대로 남는다
// (오너 발견, 2026-07-04: "strength 50분"). 알려진 사전 정의 운동 라벨(한/영)만 역매핑해
// 현재 로케일로 재번역하고, 사용자가 "직접입력"으로 타이핑한 커스텀 운동명은 그대로 둔다.
import i18n from '../i18n';

const RAW_LABEL_TO_ID: Record<string, string> = {
  // 신규 저장값(2026-07-29 이후): 언어 무관 키 자체가 저장된다.
  walk: 'walk', strength: 'strength', balance: 'balance', stretch: 'stretch',
  bike: 'bike', swim: 'swim', dance: 'dance', boxing: 'boxing', yoga: 'yoga', jog: 'jog',
  // 과거 저장값: 기록 당시 언어의 번역 라벨이 그대로 저장돼 있다 — 전부 역매핑.
  '걷기': 'walk', 'Walking': 'walk', 'Marche': 'walk', 'ウォーキング': 'walk',
  '근력': 'strength', 'Strength': 'strength', 'Renforcement': 'strength', '筋力トレーニング': 'strength',
  '균형': 'balance', 'Balance': 'balance', 'Équilibre': 'balance', 'バランス運動': 'balance',
  '스트레칭': 'stretch', 'Stretching': 'stretch', 'Étirements': 'stretch', 'ストレッチ': 'stretch',
  '자전거': 'bike', 'Cycling': 'bike', 'Vélo': 'bike', '自転車': 'bike',
  '수영': 'swim', 'Swimming': 'swim', 'Natation': 'swim', '水泳': 'swim',
  '댄스': 'dance', 'Dancing': 'dance', 'Danse': 'dance', 'ダンス': 'dance',
  '복싱': 'boxing', 'Boxing': 'boxing', 'Boxe': 'boxing', 'ボクシング': 'boxing',
  '요가': 'yoga', 'Yoga': 'yoga', 'ヨガ': 'yoga',
  '조깅': 'jog', 'Jogging': 'jog', 'ジョギング': 'jog',
};

const ID_TO_LABEL_KEY: Record<string, string> = {
  walk: 'exercise.types.walkLabel',
  strength: 'exercise.types.strengthLabel',
  balance: 'exercise.types.balanceLabel',
  stretch: 'exercise.types.stretchLabel',
  bike: 'exercise.types.bikeLabel',
  swim: 'exercise.types.swimLabel',
  dance: 'exercise.types.danceLabel',
  boxing: 'exercise.types.boxingLabel',
  yoga: 'exercise.types.yogaLabel',
  jog: 'exercise.types.jogLabel',
};

export function translateRawExerciseType(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  const id = RAW_LABEL_TO_ID[trimmed];
  if (!id) return trimmed; // 사전 정의 라벨이 아니면 커스텀 입력 — 그대로 표시(회귀 방지)
  return i18n.t(ID_TO_LABEL_KEY[id]);
}

/** 저장값(키 또는 옛 라벨) → 운동 종류 키. 사전 정의가 아니면 null. */
export function exerciseTypeId(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  return RAW_LABEL_TO_ID[trimmed] ?? null;
}
