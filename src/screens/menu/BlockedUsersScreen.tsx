import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { supabase } from '../../lib/supabase';
import { useBlocks } from '../../hooks/useBlocks';
import { useDialog } from '../../context/DialogContext';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

interface BlockedUser {
  id: string;
  name: string;
  role: string | null;
}

/** 역할 코드 → 사용자에게 보이는 라벨 (환자 일반어 노출 규칙 준수: 보호자만 명시) */
function roleLabel(role: string | null): string | null {
  if (role === 'caregiver') return i18n.t('blockedUsers.roleCaregiver');
  return null;
}

/**
 * 차단한 사용자 관리 화면.
 *
 * 내가 차단한 커뮤니티 사용자 목록을 보여주고, 각 사용자를 차단 해제할 수 있다.
 * - user_blocks(blocked_id) → public_user_profiles(id·name·role) 2-step 조회로 이름 매핑.
 * - 차단 해제 시 useBlocks.unblockUser 호출 → 피드/댓글은 재진입 시 refresh 로 자동 반영.
 */
export function BlockedUsersScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const dialog = useDialog();
  const { unblockUser } = useBlocks();
  const bottomPadding = useBottomSheetPadding();

  const [loading, setLoading] = React.useState(true);
  const [users, setUsers] = React.useState<BlockedUser[]>([]);
  // 해제 처리 중인 사용자 id (버튼 중복 탭 방지)
  const [removingId, setRemovingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        setUsers([]);
        return;
      }
      // 1) 내가 차단한 사용자 id 목록
      const { data: blockRows } = await supabase
        .from('user_blocks')
        .select('blocked_id')
        .eq('blocker_id', session.user.id);
      const ids = (blockRows ?? []).map((b: any) => b.blocked_id as string);
      if (ids.length === 0) {
        setUsers([]);
        return;
      }
      // 2) 이름·역할 매핑 (검증된 공개 뷰, 2-step 조회)
      const { data: profiles } = await supabase
        .from('public_user_profiles')
        .select('id, name, role')
        .in('id', ids);
      const mapped: BlockedUser[] = ids.map((id) => {
        const p = (profiles ?? []).find((row: any) => row.id === id) as any;
        return {
          id,
          name: p?.name ?? t('blockedUsers.unknownUser'),
          role: p?.role ?? null,
        };
      });
      setUsers(mapped);
    } catch (e) {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleUnblock = async (target: BlockedUser) => {
    const ok = await dialog.confirm({
      title: t('blockedUsers.unblockTitle'),
      message: t('blockedUsers.unblockMsg', { name: target.name }),
      confirmText: t('blockedUsers.unblockBtn'),
      cancelText: t('blockedUsers.cancel'),
    });
    if (!ok) return;
    setRemovingId(target.id);
    const success = await unblockUser(target.id);
    setRemovingId(null);
    if (!success) {
      dialog.alert({
        title: t('blockedUsers.errorTitle'),
        message: t('blockedUsers.unblockFailMsg'),
      });
      return;
    }
    setUsers((prev) => prev.filter((u) => u.id !== target.id));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title={t('blockedUsers.headerTitle')} showBack />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : users.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="ban-outline" size={56} color={Colors.textHint} />
          <Text style={styles.emptyTitle}>{t('blockedUsers.noBlockedTitle')}</Text>
          <Text style={styles.emptyDesc}>
            {t('blockedUsers.noBlockedDesc')}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sectionCard}>
            {users.map((u, index) => {
              const label = roleLabel(u.role);
              const removing = removingId === u.id;
              return (
                <View key={u.id}>
                  <View style={styles.row}>
                    <View style={styles.avatar}>
                      <Ionicons name="person-outline" size={28} color={Colors.primary} />
                    </View>
                    <View style={styles.textWrap}>
                      <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
                      {label ? <Text style={styles.roleText}>{label}</Text> : null}
                    </View>
                    <TouchableOpacity
                      style={styles.unblockBtn}
                      onPress={() => handleUnblock(u)}
                      disabled={removing}
                      activeOpacity={0.8}
                    >
                      {removing ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : (
                        <Text style={styles.unblockBtnText}>{t('blockedUsers.unblockBtn')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {index < users.length - 1 && <View style={styles.divider} />}
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 24,
  },

  scroll: { flex: 1 },
  scrollContent: {
    padding: 16,
  },

  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 72,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  textWrap: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  roleText: {
    fontSize: 16,
    color: Colors.textSub,
  },
  unblockBtn: {
    minWidth: 92,
    minHeight: 48,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark,
  },
});
