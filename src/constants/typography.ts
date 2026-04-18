// 60대 이상 타겟 - 절대 이 기준 이하로 내리지 말 것
export const Typography = {
  title: { fontSize: 24, fontWeight: '700' as const },
  subtitle: { fontSize: 20, fontWeight: '700' as const },
  bodyBold: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  sub: { fontSize: 14, fontWeight: '400' as const },
  hint: { fontSize: 12, fontWeight: '400' as const },
} as const;

export const MIN_BUTTON_HEIGHT = 56;
export const MIN_FONT_SIZE = 18;
