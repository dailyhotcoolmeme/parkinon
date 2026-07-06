import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';

interface DatePickerModalProps {
  visible: boolean;
  selectedDate: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DatePickerModal({ visible, selectedDate, onSelect, onClose }: DatePickerModalProps) {
  const { t, i18n } = useTranslation();
  const isEn = (i18n.language || '').toLowerCase().startsWith('en');
  const WEEKDAYS = isEn ? WEEKDAYS_EN : WEEKDAYS_KO;
  const [viewYear, setViewYear] = useState(selectedDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(selectedDate.getMonth());

  useEffect(() => {
    if (visible) {
      setViewYear(selectedDate.getFullYear());
      setViewMonth(selectedDate.getMonth());
    }
  }, [visible]);

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay();
  const today = new Date();

  const goToPrev = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };

  const goToNext = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const handleDayPress = (day: number) => {
    onSelect(new Date(viewYear, viewMonth, day));
    onClose();
  };

  const handleToday = () => {
    onSelect(new Date());
    onClose();
  };

  // Build cell array (nulls for leading empty cells)
  const cells: (number | null)[] = [
    ...Array(firstDayOfWeek).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>

          {/* ── 월 탐색 헤더 ── */}
          <View style={styles.monthNav}>
            <TouchableOpacity style={styles.navArrow} onPress={goToPrev} activeOpacity={0.7}>
              <Text style={styles.navArrowText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.monthTitle}>
              {isEn
                ? new Date(viewYear, viewMonth).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                : t('datePicker.monthTitle', { year: viewYear, month: viewMonth + 1 })}
            </Text>
            <TouchableOpacity style={styles.navArrow} onPress={goToNext} activeOpacity={0.7}>
              <Text style={styles.navArrowText}>›</Text>
            </TouchableOpacity>
          </View>

          {/* ── 요일 헤더 ── */}
          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text
                key={w}
                style={[
                  styles.weekLabel,
                  i === 0 && styles.sundayLabel,
                  i === 6 && styles.saturdayLabel,
                ]}
              >
                {w}
              </Text>
            ))}
          </View>

          {/* ── 날짜 그리드 ── */}
          <View style={styles.grid}>
            {cells.map((day, idx) => {
              if (!day) return <View key={`empty-${idx}`} style={styles.dayCell} />;

              const isSel =
                day === selectedDate.getDate() &&
                viewMonth === selectedDate.getMonth() &&
                viewYear === selectedDate.getFullYear();
              const isToday =
                day === today.getDate() &&
                viewMonth === today.getMonth() &&
                viewYear === today.getFullYear();
              const col = idx % 7;

              return (
                <TouchableOpacity
                  key={day}
                  style={[styles.dayCell, isSel && styles.dayCellSelected]}
                  onPress={() => handleDayPress(day)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.dayText,
                      col === 0 && styles.sundayText,
                      col === 6 && styles.saturdayText,
                      isSel && styles.dayTextSelected,
                    ]}
                  >
                    {day}
                  </Text>
                  {isToday && !isSel && <View style={styles.todayDot} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── 하단 버튼 ── */}
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.todayBtn} onPress={handleToday} activeOpacity={0.85}>
              <Text style={styles.todayBtnText}>{t('datePicker.today')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.closeBtnText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>

        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    width: 340,
    paddingVertical: 20,
    paddingHorizontal: 16,
  },

  // 월 탐색
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    backgroundColor: Colors.background,
  },
  navArrowText: { fontSize: 28, color: Colors.text, lineHeight: 32 },
  monthTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },

  // 요일 행
  weekRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
    paddingVertical: 4,
  },
  sundayLabel: { color: '#E53935' },
  saturdayLabel: { color: '#1565C0' },

  // 날짜 그리드
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellSelected: {
    backgroundColor: Colors.primary,
    borderRadius: 100,
  },
  dayText: {
    fontSize: 18,
    fontWeight: '500',
    color: Colors.text,
  },
  dayTextSelected: { color: Colors.white, fontWeight: '700' },
  sundayText: { color: '#E53935' },
  saturdayText: { color: '#1565C0' },
  todayDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.primary,
    marginTop: 2,
  },

  // 하단 버튼
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  todayBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  closeBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});
