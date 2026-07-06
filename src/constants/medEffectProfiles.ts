/**
 * 약효추적 시간 추천 — 큐레이션 상수
 *
 * 사양 단일 진실 소스: docs/med_effect_tracking_recommendation_spec.md (§4, §4.2, §3-A)
 *
 * ⚠️ 이 테이블의 분 단위 수치는 의학적 확정값이 아닌 임상 레퍼런스 기반 "일반 참고 추천"이다.
 *    UI 노출 지점에는 반드시 "주치의와 상의해 조정하세요" 디스클레이머를 표시할 것(§9, §9-A).
 *
 * 추적 대상 한정(§3-A): 약효추적 알림 추천은 레보도파 계열만 active:true 이다.
 *    비레보도파 분류(도파민작용제·로티고틴패치·COMT·MAO-B·아만타딘·항콜린제)는 전부
 *    "추적 비대상"(active:false). 약효추적 알림은 생성하지 않으나 약 정보·식약처 원문 링크는
 *    모든 약에 제공한다("추적 비대상"은 알림만 안 만드는 것이지 약 정보를 숨기는 것이 아님).
 */

/** 파킨슨 약 분류 키 */
export type DrugClass =
  | 'levodopa_ir'
  | 'levodopa_cr'
  | 'levodopa_entacapone'
  | 'dopamine_agonist'
  | 'rotigotine_patch'
  | 'comt_inhibitor'
  | 'mao_b_inhibitor'
  | 'amantadine'
  | 'anticholinergic';

/** 약효추적 추천 결과 */
export type TrackingRecommendation = {
  drugClass: DrugClass;
  /** 권장 약효추적 오프셋(분). 빈 배열 = 추적 기본 OFF */
  offsets: number[];
  /** 추천 활성 여부. false면 알림 설정 자동 채움 비활성(추적 비대상) */
  active: boolean;
  /** UI에 띄울 분류별 안내 문구 (디스클레이머와 별개의 분류 특이사항) */
  note?: string;
  /** note의 영어 번역 (해외 로케일용). isEnLocale() 분기는 소비측(recommendUtils)에서 처리. */
  noteEn?: string;
  /**
   * @deprecated UI 미사용(§7.5). 추천근거는 약효 설명 문장이 아니라 "출처 표기" 한 줄로
   * 바뀌었다(recommendUtils.SOURCE_LABEL). onset/tmax/duration → 일반어 환산 문장이던
   * 이 필드는 더 이상 화면에 노출되지 않는다. 참고용 메모로만 남겨둔다.
   */
  rationale?: string;
};

/**
 * 분류 → 추천 오프셋 매핑 (임상 레퍼런스 기반 기본 추천값, 의학적 확정값 아님)
 * 추적 대상 한정(§3-A): 레보도파 계열만 active:true. 비레보도파는 전부 추적 비대상(active:false).
 */
export const CLASS_RECOMMENDATION: Record<DrugClass, TrackingRecommendation> = {
  // ── 추적 대상 (레보도파 계열만) ──
  levodopa_ir: {
    drugClass: 'levodopa_ir',
    offsets: [30, 60, 120],
    active: true,
    // onset ~30분 / tmax ~1시간 / 효과 약 4~6시간 지속, 2시간 전후부터 변화 관찰 (속효성 레보도파, 임상 레퍼런스)
    rationale: '복용 30분쯤부터 약효가 오르기 시작해 1시간 전후로 가장 강하고, 2시간쯤부터는 조금씩 약해질 수 있어요.',
  },
  levodopa_cr: {
    drugClass: 'levodopa_cr',
    offsets: [60, 180],
    active: true,
    // 서방형(천천히 녹음) — onset 느리고 duration 김
    rationale: '서서히 녹는 약이라 1시간쯤부터 약효가 오르고, 속효성보다 더 오래 유지돼요.',
  },
  levodopa_entacapone: {
    drugClass: 'levodopa_entacapone',
    offsets: [30, 90, 180],
    active: true,
    // 엔타카폰이 레보도파 분해를 늦춰 효과를 연장
    rationale: '엔타카폰이 함께 들어 있어 약효가 30분쯤부터 오르고, 레보도파 단독보다 더 길게 이어져요.',
  },
  // ── 추적 비대상 (비레보도파 — 약효추적 알림 미생성, 약 정보·식약처 링크는 제공) ──
  dopamine_agonist: {
    drugClass: 'dopamine_agonist',
    offsets: [],
    active: false,
    note: '이 약은 약효추적 알림 대상이 아니에요. 레보도파 약 기준으로 추적해요.',
    noteEn: "This medication isn't tracked for effect timing. Tracking is based on your levodopa medication instead.",
  },
  rotigotine_patch: {
    drugClass: 'rotigotine_patch',
    offsets: [],
    active: false,
    note: '붙이는 약(패치)이라 복용 후 추적 알림이 맞지 않아요.',
    noteEn: "This is a patch, so a post-dose tracking alert doesn't apply.",
  },
  comt_inhibitor: {
    drugClass: 'comt_inhibitor',
    offsets: [],
    active: false,
    note: '레보도파와 함께 드시는 약이에요. 레보도파 기준으로 추적해요.',
    noteEn: 'This medication is taken together with levodopa. Tracking is based on your levodopa medication.',
  },
  mao_b_inhibitor: {
    drugClass: 'mao_b_inhibitor',
    offsets: [],
    active: false,
    note: '이 약은 약효추적 알림 대상이 아니에요.',
    noteEn: "This medication isn't tracked for effect timing.",
  },
  amantadine: {
    drugClass: 'amantadine',
    offsets: [],
    active: false,
    note: '이 약은 약효추적 알림 대상이 아니에요.',
    noteEn: "This medication isn't tracked for effect timing.",
  },
  anticholinergic: {
    drugClass: 'anticholinergic',
    offsets: [],
    active: false,
    note: '이 약은 약효추적 알림 대상이 아니에요.',
    noteEn: "This medication isn't tracked for effect timing.",
  },
};

/**
 * 약명/성분 키워드 → 분류 매핑.
 * 소문자·공백제거 후 includes(부분일치) 매칭하며, 가장 구체적인 분류가 먼저 오도록 정렬했다
 * (스타레보 → CR → IR 순 — §5). 위에서부터 순회해 첫 매칭을 채택한다.
 */
export const KEYWORD_TO_CLASS: { keywords: string[]; cls: DrugClass }[] = [
  { cls: 'levodopa_entacapone', keywords: ['스타레보', 'stalevo'] },
  { cls: 'levodopa_cr', keywords: ['시네메트cr', 'cr정', 'hbs', '마도파hbs', '서방형'] },
  {
    cls: 'levodopa_ir',
    keywords: ['시네메트', '퍼킨', '마도파', '레보도파', 'levodopa', 'sinemet', 'madopar'],
  },
  {
    cls: 'dopamine_agonist',
    keywords: [
      '미라펙스',
      '프라미펙솔',
      'pramipexole',
      '리큅',
      '로피니롤',
      'ropinirole',
      'mirapex',
      'requip',
    ],
  },
  { cls: 'rotigotine_patch', keywords: ['뉴프로', '로티고틴', 'rotigotine', 'neupro', '패치'] },
  {
    cls: 'comt_inhibitor',
    keywords: ['콤탄', '엔타카폰', 'entacapone', '온젠티스', '오피카폰', 'opicapone', 'comtan'],
  },
  {
    cls: 'mao_b_inhibitor',
    keywords: ['셀레길린', 'selegiline', '아질렉트', '라사길린', 'rasagiline', 'azilect'],
  },
  { cls: 'amantadine', keywords: ['아만타딘', 'amantadine', 'pk-merz', '피케이멜츠'] },
  {
    cls: 'anticholinergic',
    keywords: ['트리헥신', '트리헥시페니딜', 'trihexyphenidyl', '벤즈트로핀', 'benztropine'],
  },
];
