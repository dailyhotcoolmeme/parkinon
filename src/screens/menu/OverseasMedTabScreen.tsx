// 해외판 전용 탭 화면 — 정보나눔(커뮤니티) 탭 대신 노출.
// 정보나눔 탭(FeedScreen)과 동일한 패턴: 정식 TopBar + 그 아래 밑줄(underline) 스타일 탭 2개
// ("약 관리" / "복용시간 설정·알림")로 기존 MedicationManageScreen을 mode만 바꿔 재사용한다.
// 내부 MedicationManageScreen 자체 TopBar는 hideTopBar로 숨겨 중복 방지.
// 국내는 기존 5탭 그대로 유지되며, 이 화면은 해외 로케일에서만 MainNavigator 4번째 탭으로 연결된다.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { navigateTo } from '../../navigation/navigationRef';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { MedicationManageScreen } from './MedicationManageScreen';

type SegKey = 'meds' | 'slots';

export function OverseasMedTabScreen() {
  const { t } = useTranslation();
  const { unreadCount } = useNotificationBadge();
  const [active, setActive] = useState<SegKey>('meds');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={t('medication.brandTitle')}
        showParkinon
        showDiary
        onDiaryPress={() => navigateTo('Diary')}
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigateTo('NotificationHistory', { mode: 'all' })}
      />

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, active === 'meds' && styles.tabActive]}
          onPress={() => setActive('meds')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabText, active === 'meds' && styles.tabTextActive]} numberOfLines={1}>
            {t('menu.medsTabLabel')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, active === 'slots' && styles.tabActive]}
          onPress={() => setActive('slots')}
          activeOpacity={0.75}
        >
          <Text style={[styles.tabText, active === 'slots' && styles.tabTextActive]} numberOfLines={1}>
            {t('menu.doseSlotsTabLabel')}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <MedicationManageScreen
          modeOverride={active}
          hideBack
          hideTopBar
          onGoRegisterMeds={() => setActive('meds')}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.white },
  // 정보나눔(FeedScreen) tabRow/tab 스타일과 동일한 밑줄 방식
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor: Colors.white,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: Colors.primary,
  },
  tabText: {
    fontSize: 17,
    fontWeight: '500',
    color: '#888888',
  },
  tabTextActive: {
    fontWeight: '700',
    color: Colors.primary,
  },
  content: { flex: 1 },
});
