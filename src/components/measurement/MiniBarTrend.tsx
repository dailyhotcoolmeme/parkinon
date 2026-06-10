// 디지털 바이오마커 MVP-A Phase 3 — 7/30일 추세 미니 막대그래프 (§6.5)
//
// View(flex) 기반 — react-native-svg 의존성 없이 그림. 새 네이티브 모듈 추가 금지.
// - 7일 또는 30일치 일별 평균 막대(데이터 있는 날 진녹 #4CAF50, 없는 날 연회색 #E0E0E0)
// - baseline 평균 가로 점선 #999 (전달 시)
// - 60대+ 가독성 우선: 막대 폭 충분(>=6dp), 막대 간격 최소(1dp)
// - 방향: 왼쪽 = 오늘(최신), 오른쪽 = N일 전(과거). props.days는 시간 오름차순으로 들어와도
//   내부에서 reverse하여 그림. "오늘" 라벨은 좌측에 위치.
// - 단위 라벨(yLabel): 그래프 영역 바깥(헤더 우측)에 표시 — 막대 위 "오늘" 라벨과 겹치지 않게.
// - rangeDays(선택): 헤더/푸터 라벨 및 막대 위 값 폰트 크기를 결정. 기본 30. 7이면 폭 여유로 폰트 12sp.
//
// 의존: 없음(React Native 표준). 새 컴포넌트지만 디자인 토큰(Colors) 재사용.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';

export interface MiniBarTrendDay {
  /** YYYY-MM-DD */
  date: string;
  /** 측정 없음이면 null */
  value: number | null;
}

export interface MiniBarTrendProps {
  days: MiniBarTrendDay[];
  /** 본인 30일 평균선 값 (null이면 평균선 숨김 — 학습 미완료 또는 표본 부족) */
  baselineMean: number | null;
  /** Y축 라벨(예: "회", "ms"). 표시 시 우측 상단에 작게. */
  yLabel?: string;
  /** 그래프 영역 높이(dp). 기본 140. */
  height?: number;
  /**
   * 각 막대 위에 값을 작은 숫자로 표시할지 여부. 기본 false.
   * 데이터 있는(value>0) 막대에만 정수로 표시. null/0 막대는 라벨 없음.
   * 30일 가로 폭이 좁아 글자 크기는 9sp(7일 모드면 12sp로 자동 확대).
   */
  showValues?: boolean;
  /**
   * 보기 기간(일). 기본 30. 헤더/푸터 라벨과 막대 위 값 폰트 크기를 결정.
   * - 7: 헤더 "최근 7일 추세", 푸터 "7일 전", 라벨 폰트 12sp, 라벨 width 50dp
   * - 30: 헤더 "최근 30일 추세", 푸터 "30일 전", 라벨 폰트 9sp, 라벨 width 40dp
   */
  rangeDays?: number;
}

/** 단일 톤 막대그래프 + baseline 평균 점선 */
export function MiniBarTrend({
  days,
  baselineMean,
  yLabel,
  height = 140,
  showValues = false,
  rangeDays = 30,
}: MiniBarTrendProps) {
  // 7일 모드면 컬럼 폭이 넉넉하므로 막대 위 값 폰트를 12sp로 키우고 width도 확대.
  // 30일 모드는 기존 9sp/40dp 유지 (좁은 컬럼 ellipsis 회피).
  const isShortRange = rangeDays <= 7;
  const valueLabelFontSize = isShortRange ? 12 : 9;
  const valueLabelLineHeight = isShortRange ? 14 : 11;
  const valueLabelWidth = isShortRange ? 50 : 40;
  const valueLabelMarginLeft = -valueLabelWidth / 2;
  const headerLeftText = `최근 ${rangeDays}일 추세`;
  const footerRightText = `${rangeDays}일 전`;
  // y축 스케일: 데이터 + baseline 중 최대값으로 정규화. 0 또는 음수 안전 처리.
  const maxValue = useMemo(() => {
    let m = 0;
    for (const d of days) {
      if (d.value !== null && Number.isFinite(d.value)) {
        if (d.value > m) m = d.value;
      }
    }
    if (baselineMean !== null && Number.isFinite(baselineMean) && baselineMean > m) {
      m = baselineMean;
    }
    // 막대가 영역 끝까지 닿지 않도록 10% 헤드룸
    return m > 0 ? m * 1.1 : 1;
  }, [days, baselineMean]);

  // baseline 점선 위치(영역 상단 기준 px) — 막대가 자라는 방향과 일치하도록
  const baselineTopPct =
    baselineMean !== null && Number.isFinite(baselineMean) && maxValue > 0
      ? 100 - (baselineMean / maxValue) * 100
      : null;

  // 호출처는 시간 오름차순(과거→오늘)으로 days를 넘기지만,
  // 그래프는 왼쪽=오늘(최신), 오른쪽=30일 전(과거) 방향으로 그린다.
  // 원본 배열은 변형하지 않도록 slice 후 reverse.
  const renderedDays = useMemo(() => days.slice().reverse(), [days]);

  // 막대 영역 가로 폭은 flex로 균등 분배. 막대 자체는 flex:1 + 사이 gap.
  return (
    <View style={styles.wrap}>
      {/* 상단 라벨 — 단위 라벨은 헤더 우측에 위치(그래프 "오늘" 라벨과 겹침 방지) */}
      <View style={styles.headerRow}>
        <Text style={styles.headerLeft}>{headerLeftText}</Text>
        <View style={styles.headerRight}>
          {baselineMean !== null && Number.isFinite(baselineMean) && (
            <View style={styles.legendItem}>
              <View style={styles.legendDashLine} />
              <Text style={styles.legendText}>평소 평균</Text>
            </View>
          )}
          {!!yLabel && (
            <Text style={styles.unitText}>단위: {yLabel}</Text>
          )}
        </View>
      </View>

      {/* 그래프 영역 */}
      <View style={[styles.chartArea, { height }]}>
        {/* baseline 점선(평균선) */}
        {baselineTopPct !== null && (
          <View
            pointerEvents="none"
            style={[
              styles.baselineLineWrap,
              { top: `${baselineTopPct}%` },
            ]}
          >
            <View style={styles.baselineLine} />
          </View>
        )}

        {/* 막대들 — 왼쪽=오늘, 오른쪽=30일 전 */}
        <View style={styles.barsRow}>
          {renderedDays.map((d, idx) => {
            const hasValue =
              d.value !== null && Number.isFinite(d.value) && (d.value ?? 0) > 0;
            const heightPct = hasValue
              ? Math.max(2, ((d.value as number) / maxValue) * 100)
              : 4; // 빈 날도 회색 점선 톤으로 살짝 표시
            const showLabel = showValues && hasValue;
            // 막대 위에 표시할 정수 값 (탭핑: 회 / 반응속도: ms 정수)
            const labelText = showLabel
              ? String(Math.round(d.value as number))
              : '';
            return (
              <View key={d.date + '-' + idx} style={styles.barCol}>
                {showLabel && (
                  // 좁은 30일 컬럼에서 ellipsis 회피:
                  // - absolute로 띄워 컬럼 폭(약 8~10dp)에 종속되지 않게
                  // - 가로 음수 마진으로 인접 칸 침범 허용(가독성 우선, 인접 라벨 약간 겹침 허용)
                  // - numberOfLines 제거: 한 줄 텍스트는 width로 잘리는 게 아니라 표시 영역으로 잘림
                  // - 7일 모드면 폭 여유로 폰트 12sp/width 50dp, 30일 모드는 9sp/40dp.
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.barValueLabel,
                      {
                        bottom: `${heightPct}%`,
                        fontSize: valueLabelFontSize,
                        lineHeight: valueLabelLineHeight,
                        width: valueLabelWidth,
                        marginLeft: valueLabelMarginLeft,
                      },
                    ]}
                  >
                    {labelText}
                  </Text>
                )}
                <View
                  style={[
                    styles.bar,
                    {
                      height: `${heightPct}%`,
                      backgroundColor: hasValue ? Colors.primary : '#E0E0E0',
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>

      {/* 하단 보조 라벨 — 왼쪽=오늘, 오른쪽=N일 전 */}
      <View style={styles.footerRow}>
        <Text style={styles.footerText}>오늘</Text>
        <Text style={styles.footerText}>{footerRightText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerLeft: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDashLine: {
    width: 22,
    height: 0,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#999999',
  },
  legendText: {
    fontSize: 13,
    color: Colors.textSub,
    fontWeight: '600',
  },

  chartArea: {
    width: '100%',
    position: 'relative',
    backgroundColor: '#FAFAFA',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
    // 좌우 끝 컬럼의 라벨(width 40dp, 중앙정렬)이 chartArea를 살짝 벗어날 수 있어 visible.
    // 배경 라운드는 borderRadius로 유지되되 자식 라벨은 잘리지 않음.
    overflow: 'visible',
  },
  baselineLineWrap: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: 0,
    zIndex: 2,
  },
  baselineLine: {
    width: '100%',
    height: 0,
    borderTopWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#999999',
  },
  barsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    zIndex: 1,
  },
  barCol: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'stretch',
    height: '100%',
    // 라벨이 absolute로 컬럼 밖으로 살짝 나갈 수 있게 — barsRow는 overflow:hidden 없음
    position: 'relative',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    minHeight: 2,
  },
  // 막대 위 값 라벨 — 30일 좁은 폭 고려.
  // RN absolute에서 left+right 둘 다 지정하면 width = 부모폭 - left - right로 stretch되어
  // 좁은 컬럼에서 ellipsis 발생. 따라서:
  // - 명시 width(40dp) 부여 — 4자리 숫자(예: 1234)까지 안 잘림
  // - left: '50%' + marginLeft: -20 으로 컬럼 가운데 정렬
  // - right 미지정 → stretch 회피
  // - 인접 라벨이 살짝 겹칠 수 있으나 가독성 우선
  barValueLabel: {
    position: 'absolute',
    bottom: 0, // 인라인 style의 bottom: heightPct%로 덮어씀
    width: 40,
    left: '50%',
    marginLeft: -20,
    fontSize: 9,
    lineHeight: 11,
    color: Colors.text,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 1,
    includeFontPadding: false,
  },

  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  footerText: {
    fontSize: 12,
    color: Colors.textSub,
  },
  unitText: {
    fontSize: 13,
    color: Colors.textSub,
    fontWeight: '600',
  },
});
