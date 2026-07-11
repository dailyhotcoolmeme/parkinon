// 시간대 슬롯 아이콘 — 해/달을 플랫·기하학적으로 다듬은 커스텀 도형(이모지·AI 티 제거).
//   아침=뜨는 해 / 점심·오후=꽉 찬 해 / 저녁=수평선 위 뜨는 달 / 새벽·밤=초승달.
// react-native-svg(네이티브 모듈) 미사용 — 흰색 템플릿 PNG + tintColor로 시간대 색을 입혀
// OTA 안전하게 그린다. periodEmoji(구 이모지)와 동일한 시간 구간을 쓴다.
import React from 'react';
import { Image, ImageSourcePropType } from 'react-native';

type Kind = 'sunRise' | 'sunFull' | 'moonRise' | 'moon';

const ICON_SRC: Record<Kind, ImageSourcePropType> = {
  sunRise: require('../../../assets/slot-icons/slot-sun-rise.png'),
  sunFull: require('../../../assets/slot-icons/slot-sun-full.png'),
  moonRise: require('../../../assets/slot-icons/slot-moon-rise.png'),
  moon: require('../../../assets/slot-icons/slot-moon.png'),
};

// 도형이 캔버스를 채우는 비율이 달라 같은 size라도 시각 크기가 제각각 →
// kind별 보정(점심=8광선으로 꽉 차 크게 보임 축소 / 저녁=초승달이 작아 확대).
const KIND_SCALE: Record<Kind, number> = {
  sunRise: 1,
  sunFull: 0.84,
  moonRise: 1.2,
  moon: 1,
};

/** 'HH:MM' → 아이콘 종류 + 색 (periodEmoji 구간과 1:1). */
export function slotIconMeta(time: string | null | undefined): { kind: Kind; color: string } {
  const h = parseInt((time ?? '').split(':')[0] ?? '', 10);
  if (Number.isNaN(h)) return { kind: 'moon', color: '#5E35B1' };
  if (h < 6) return { kind: 'moon', color: '#5C6BC0' };       // 새벽
  if (h < 11) return { kind: 'sunRise', color: '#FB8C00' };   // 아침
  if (h < 13) return { kind: 'sunFull', color: '#F9A825' };   // 점심
  if (h < 17) return { kind: 'sunFull', color: '#FFB300' };   // 오후
  if (h < 21) return { kind: 'moonRise', color: '#7E57C2' };  // 저녁
  return { kind: 'moon', color: '#5E35B1' };                  // 밤
}

export function SlotTimeIcon({
  time,
  size = 26,
  color: colorOverride,
}: {
  time: string | null | undefined;
  size?: number;
  /** 색 강제(비활성 dim 등). 없으면 시간대 자동색. */
  color?: string;
}) {
  const meta = slotIconMeta(time);
  const color = colorOverride ?? meta.color;
  const px = Math.round(size * KIND_SCALE[meta.kind]);
  return (
    <Image
      source={ICON_SRC[meta.kind]}
      style={{ width: px, height: px, tintColor: color }}
      resizeMode="contain"
    />
  );
}
