import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, CommonActions } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { TopBar } from '../../components/common/TopBar';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────
interface NotifLog {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

interface Section {
  title: string;
  data: NotifLog[];
}


// ─────────────────────────────────────────────
// 알림 타입 설정
// ─────────────────────────────────────────────
const NOTIF_CONFIG: Record<
  string,
  { icon: string; bgColor: string; iconColor: string; tappable: boolean; navigateTo?: string }
> = {
  medication_reminder:  { icon: 'medkit',           bgColor: '#E8F5E9', iconColor: '#2E7D32', tappable: true,  navigateTo: 'Medication' },
  effect_tracking:      { icon: 'body',             bgColor: '#FFF3E0', iconColor: '#E65100', tappable: true,  navigateTo: 'BodyStateTab' },
  exercise_reminder:    { icon: 'walk',             bgColor: '#E3F2FD', iconColor: '#1565C0', tappable: true,  navigateTo: 'Exercise' },
  missed_medication:    { icon: 'alert-circle',     bgColor: '#FFEBEE', iconColor: '#B71C1C', tappable: true,  navigateTo: 'Medication' },
  caregiver_medication: { icon: 'checkmark-circle', bgColor: '#E8F5E9', iconColor: '#2E7D32', tappable: false },
  caregiver_body_state: { icon: 'happy',            bgColor: '#FFF3E0', iconColor: '#E65100', tappable: false },
  caregiver_exercise:   { icon: 'fitness',          bgColor: '#E3F2FD', iconColor: '#1565C0', tappable: false },
  caregiver_missed_med: { icon: 'warning',          bgColor: '#FFEBEE', iconColor: '#B71C1C', tappable: false },
};
const DEFAULT_NOTIF_CONFIG = { icon: 'notifications', bgColor: '#F5F5F5', iconColor: '#616161', tappable: false };

// ─────────────────────────────────────────────
// 유틸 함수
// ─────────────────────────────────────────────
function groupByDate(logs: NotifLog[]): Section[] {
  const groups: Record<string, NotifLog[]> = {};
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });

  for (const log of logs) {
    const d = new Date(log.created_at);
    const dateKey = d.toLocaleDateString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(log);
  }

  return Object.entries(groups).map(([key, data]) => ({
    title:
      key === today
        ? '오늘'
        : key === yesterday
        ? '어제'
        : new Date(data[0].created_at).toLocaleDateString('ko-KR', {
            month: 'long',
            day: 'numeric',
          }),
    data,
  }));
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${ampm} ${hour}:${String(m).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
export function NotificationHistoryScreen() {
  const { user } = useAuth();

  const { markAllRead, markRead, refreshBadge } = useNotificationBadge();
  const navigation = useNavigation();

  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchLogs = useCallback(
    async (targetDays: number) => {
      if (!user?.id) return;
      setLoading(true);

      const since = new Date(Date.now() - targetDays * 86400000).toISOString();

      let query = supabase
        .from('notification_logs')
        .select('*')
        .eq('user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false });

      const { data, error } = await query;

      if (!error && data) {
        setSections(groupByDate(data as NotifLog[]));
      }
      setLoading(false);
    },
    [user?.id],
  );

  useFocusEffect(
    useCallback(() => {
      fetchLogs(days);
    }, [fetchLogs, days]),
  );

  const handleExpandDays = () => {
    setDays(30);
    fetchLogs(30);
  };

  const handleMarkAllRead = async () => {
    await markAllRead();
    const now = new Date().toISOString();
    setSections((prev) =>
      prev.map((section) => ({
        ...section,
        data: section.data.map((d) => ({ ...d, read_at: d.read_at ?? now })),
      }))
    );
    refreshBadge();
  };

  const handleItemPress = async (item: NotifLog) => {
    const config = NOTIF_CONFIG[item.type] ?? DEFAULT_NOTIF_CONFIG;

    // 읽음 처리 (미읽 항목만)
    if (!item.read_at) {
      await markRead(item.id);
      refreshBadge();
    }

    // 읽음 상태로 UI 갱신
    setSections((prev) =>
      prev.map((section) => ({
        ...section,
        data: section.data.map((d) =>
          d.id === item.id ? { ...d, read_at: new Date().toISOString() } : d,
        ),
      })),
    );

    // 페이지 이동 (tappable인 경우) — 탭 화면은 Main 하위이므로 중첩 navigate 필요
    if (config.tappable && config.navigateTo) {
      navigation.dispatch(
        CommonActions.navigate('Main', { screen: config.navigateTo })
      );
    }
  };

  // ── 리스트 아이템 ──────────────────────────
  const renderItem = ({ item }: { item: NotifLog }) => {
    const config = NOTIF_CONFIG[item.type] ?? DEFAULT_NOTIF_CONFIG;
    const isAlert =
      item.type === 'missed_medication' || item.type === 'caregiver_missed_med';
    const isUnread = !item.read_at;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleItemPress(item)}
      >
        <View style={[styles.itemRow, isAlert && styles.itemRowAlert]}>
          {/* 미읽음 빨간점 — 피드와 동일 패턴 */}
          <Text style={[styles.unreadDot, !isUnread && { opacity: 0 }]}>•</Text>

          {/* 아이콘 원 */}
          <View style={[styles.iconCircle, { backgroundColor: config.bgColor }]}>
            <Ionicons
              name={config.icon as any}
              size={26}
              color={config.iconColor}
            />
          </View>

          {/* 중앙: 제목 + 본문 */}
          <View style={styles.itemCenter}>
            <Text style={[styles.itemTitle, !isUnread && styles.itemTitleRead]} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.itemBody} numberOfLines={2}>
              {item.body}
            </Text>
          </View>

          {/* 오른쪽: 시간 + chevron */}
          <View style={styles.itemRight}>
            <Text style={styles.itemTime}>{formatTime(item.created_at)}</Text>
            {config.tappable && (
              <Ionicons name="chevron-forward" size={20} color="#AAAAAA" />
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  // ── 섹션 헤더 ─────────────────────────────
  const renderSectionHeader = ({ section }: { section: Section }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderText}>{section.title}</Text>
    </View>
  );

  // ── "이전 알림 보기" 버튼 (리스트 하단) ──
  const renderFooter = () => {
    if (days >= 30) return null;
    return (
      <TouchableOpacity style={styles.moreButton} onPress={handleExpandDays} activeOpacity={0.7}>
        <Text style={styles.moreButtonText}>이전 알림 보기</Text>
      </TouchableOpacity>
    );
  };

  // ── 빈 상태 ──────────────────────────────
  const renderEmpty = () => {
    if (loading) return null;
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="notifications-off-outline" size={64} color="#CCCCCC" />
        <Text style={styles.emptyTitle}>아직 받은 알림이 없어요</Text>
        <Text style={styles.emptyBody}>{`최근 ${days}일간 받은 알림이 여기에 표시돼요.`}</Text>
      </View>
    );
  };

  // ── TopBar 우측 컴포넌트 (미읽음이 1개 이상일 때만 "전체 읽음" 표시) ──────────────────
  const hasUnread = sections.some((s) => s.data.some((d) => !d.read_at));
  const rightComponent = hasUnread ? (
    <TouchableOpacity
      onPress={handleMarkAllRead}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={styles.markAllBtn}>전체 읽음</Text>
    </TouchableOpacity>
  ) : undefined;

  // ── 로딩 ─────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.flex} edges={['top']}>
        <TopBar title="알림 내역" showBack rightComponent={rightComponent} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <TopBar title="알림 내역" showBack rightComponent={rightComponent} />
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={sections.length > 0 ? renderFooter : null}
        contentContainerStyle={sections.length === 0 ? styles.emptyListContent : undefined}
        stickySectionHeadersEnabled={false}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────
// 스타일
// ─────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // 섹션 헤더
  sectionHeader: {
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666666',
  },

  // 리스트 아이템
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.white,
  },
  itemRowAlert: {
    backgroundColor: '#FFEBEE',
  },
  unreadDot: {
    fontSize: 18,
    color: '#E53935',
    marginRight: 6,
    lineHeight: 26,
    alignSelf: 'center',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    flexShrink: 0,
  },
  itemCenter: {
    flex: 1,
    marginRight: 8,
  },
  itemTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  itemTitleRead: {
    color: '#999999',
    fontWeight: '400',
  },
  itemBody: {
    fontSize: 16,
    color: '#666666',
    lineHeight: 22,
  },
  itemRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 4,
    flexShrink: 0,
  },
  itemTime: {
    fontSize: 14,
    color: '#AAAAAA',
  },

  // 구분선
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 78,
  },

  // 이전 알림 보기 버튼
  moreButton: {
    marginHorizontal: 20,
    marginVertical: 24,
    minHeight: 56,
    borderWidth: 1.5,
    borderColor: '#CCCCCC',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreButtonText: {
    fontSize: 18,
    color: '#888888',
    fontWeight: '500',
  },

  // 전체 읽음 버튼
  markAllBtn: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
  },

  // 빈 상태
  emptyListContent: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 16,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 24,
  },
});
