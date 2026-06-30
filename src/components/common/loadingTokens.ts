// 통일 로딩 시스템 — 공용 디자인 토큰 (UX 스펙 고정값)
//
// 모든 로딩 컴포넌트가 동일한 색·치수·이징을 쓰도록 한 곳에 모은다.
// 임의 변경 금지 — UX 스펙 수치 그대로.

import { Easing } from 'react-native-reanimated';

export const LoadingTokens = {
  green: '#4CAF50',
  greenDark: '#2E7D32',
  greenTint: '#E8F5E9',

  cardBg: '#FFFFFF',
  cardRadius: 20,
  pill: 999,

  // 오버레이 딤 (0.5 아님 — 0.32)
  dim: 'rgba(17,17,17,0.32)',

  // 오버레이 카드 그림자
  shadowColor: '#111111',
  shadowOffset: { width: 0, height: 8 },
  shadowRadius: 24,
  shadowOpacity: 0.10,
  elevation: 8,

  // 간격
  cardPadding: 28,
  gap: 16,

  // 타이포
  titleColor: '#111111',
  titleSize: 17,
  titleWeight: '600' as const,
  subColor: '#666666',
  subSize: 14,
  subWeight: '400' as const,

  // 진입 애니메이션
  enterDuration: 220,
  enterRise: 12,

  // 말줄임표 (U+2026)
  ellipsis: '…',
} as const;

// ease cubic-bezier(0.4, 0, 0.2, 1)
export const standardEasing = Easing.bezier(0.4, 0, 0.2, 1);
