/*
 * 시각 선택 컬럼(오전/오후 · 시 · 분) — **탭 선택**, 휠 아님.
 *
 * 원래 `settings/DoseSlotSetList.tsx` 안에만 있던 것을 공용으로 뺐다(2026-08-15).
 * 뺀 이유: "늦게 기록" 시트(약 복용을 뒤늦게 남길 때 복용 시각을 고르는 자리)가 같은
 * 선택기를 써야 하는데, 복붙하면 한쪽만 고쳐져 두 화면의 조작감이 갈린다.
 *
 * ⚠️ 네이티브 date/time picker 를 쓰지 않는다 — 네이티브 모듈이 붙으면 OTA 배포가 막힌다.
 *   (CLAUDE.md "OTA 업데이트 원칙"). FlatList 만으로 만든다.
 * ⚠️ 60대 이상 타겟이라 **탭/선택 위주**여야 한다(CLAUDE.md UI 원칙). 휠·드래그 금지.
 */
import React, { useEffect, useRef } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors } from '../../constants/colors';

export type AmPm = 'am' | 'pm';

export const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,…,55 (5분 단위)

export const PICK_ITEM_H = 50;
/* colsRow 높이(=뷰포트). 이 안에 다 들어오는 짧은 목록(오전/오후 2개)은 스크롤이 필요 없다. */
export const PICK_COL_H = 250;

export function PickerCol<T extends string | number>({
  items,
  selected,
  onSelect,
}: {
  items: { value: T; label: string }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  const ref = useRef<FlatList<{ value: T; label: string }>>(null);
  const selectedIndex = Math.max(0, items.findIndex((it) => it.value === selected));
  /*
   * 항목이 뷰포트에 다 들어오면(예: 오전/오후 2개) 선택 항목을 맨 위로 스크롤하지 않는다.
   * 안 그러면 오후(index 1) 선택 시 오전(index 0)이 위로 밀려 숨어 고를 수 없다.
   */
  const fitsAll = items.length * PICK_ITEM_H <= PICK_COL_H;
  useEffect(() => {
    if (fitsAll) return;
    if (ref.current) ref.current.scrollToOffset({ offset: selectedIndex * PICK_ITEM_H, animated: false });
  }, [selected, selectedIndex, fitsAll]);
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={ref}
        data={items}
        keyExtractor={(it) => String(it.value)}
        initialScrollIndex={fitsAll ? 0 : selectedIndex}
        getItemLayout={(_, index) => ({ length: PICK_ITEM_H, offset: PICK_ITEM_H * index, index })}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={() => {}}
        onLayout={() => {
          if (!fitsAll && ref.current) ref.current.scrollToOffset({ offset: selectedIndex * PICK_ITEM_H, animated: false });
        }}
        renderItem={({ item }) => {
          const isSel = item.value === selected;
          return (
            <TouchableOpacity
              style={[pickStyles.item, isSel && pickStyles.itemActive]}
              activeOpacity={0.7}
              onPress={() => onSelect(item.value)}
            >
              <Text style={[pickStyles.itemText, isSel && pickStyles.itemTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

export const pickStyles = StyleSheet.create({
  colsRow: { flexDirection: 'row', height: PICK_COL_H },
  col: { flex: 1 },
  colHeader: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textSub,
    textAlign: 'center',
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 4,
  },
  colDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 8 },
  item: {
    height: PICK_ITEM_H,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 3,
    marginVertical: 1,
  },
  itemActive: { backgroundColor: Colors.light },
  itemText: { color: Colors.text, fontSize: 20 },
  itemTextActive: { color: Colors.primary, fontWeight: '700' },
});

/** 오전/오후+12시간 시각 → 'HH:MM' (DB 저장 형식). */
export function toHHMM(ampm: AmPm, hour: number, minute: number): string {
  let h24 = hour;
  if (ampm === 'am') h24 = hour === 12 ? 0 : hour;
  else h24 = hour === 12 ? 12 : hour + 12;
  return `${String(h24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 'HH:MM' → 오전/오후+12시간 시각. */
export function fromHHMM(time: string): { ampm: AmPm; hour: number; minute: number } {
  const [hStr, mStr] = time.split(':');
  const h24 = parseInt(hStr, 10);
  const minute = parseInt(mStr ?? '0', 10);
  if (h24 === 0) return { ampm: 'am', hour: 12, minute };
  if (h24 < 12) return { ampm: 'am', hour: h24, minute };
  if (h24 === 12) return { ampm: 'pm', hour: 12, minute };
  return { ampm: 'pm', hour: h24 - 12, minute };
}
