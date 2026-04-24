import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { navigateTo } from '../../navigation/navigationRef';

type NavigationProp = StackNavigationProp<MenuStackParamList, 'MenuHome'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface MenuItem {
  key: string;
  icon: IoniconName;
  label: string;
  desc: string;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

const MENU_SECTIONS: MenuSection[] = [
  {
    title: '기록',
    items: [
      {
        key: 'Records',
        icon: 'bar-chart-outline',
        label: '기록 보기',
        desc: '주간·월간 건강 기록을 확인해요',
      },
      {
        key: 'VideoList',
        icon: 'videocam-outline',
        label: '영상 기록 보기',
        desc: '촬영한 영상 기록을 확인해요',
      },
    ],
  },
  {
    title: '관리',
    items: [
      {
        key: 'MedicationManage',
        icon: 'medkit-outline',
        label: '약 관리',
        desc: '복용 중인 약을 추가·수정해요',
      },
      {
        key: 'MedicalRecordList',
        icon: 'medical-outline',
        label: '진료 기록',
        desc: '병원 진료 기록을 관리해요',
      },
      {
        key: 'FamilyLink',
        icon: 'people-outline',
        label: '가족 연동',
        desc: '보호자와 건강 기록을 공유해요',
      },
      {
        key: 'Settings',
        icon: 'notifications-outline',
        label: '알림 설정',
        desc: '약·운동 알림 시간을 설정해요',
      },
    ],
  },
  {
    title: '기타',
    items: [
      {
        key: 'Terms',
        icon: 'document-text-outline',
        label: '이용약관',
        desc: '서비스 이용약관을 확인해요',
      },
      {
        key: 'Privacy',
        icon: 'lock-closed-outline',
        label: '개인정보처리방침',
        desc: '개인정보 처리방침을 확인해요',
      },
    ],
  },
];

export function MenuScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { user, signOut, refreshUser } = useAuth();

  // 화면 포커스 시 사용자 정보 갱신 (ProfileEdit 후 이름 즉시 반영)
  useFocusEffect(
    React.useCallback(() => {
      refreshUser();
    }, [refreshUser])
  );

  const roleName = user?.role === 'caregiver' ? '보호자' : '환자';

  const handleMenuPress = (key: string) => {
    if (key === 'Records') {
      navigation.navigate('Records');
    } else if (key === 'VideoList') {
      navigation.navigate('VideoList');
    } else if (key === 'Settings') {
      navigation.navigate('Settings');
    } else if (key === 'MedicationManage') {
      navigation.navigate('MedicationManage');
    } else if (key === 'FamilyLink') {
      navigation.navigate('FamilyLink');
    } else if (key === 'Terms') {
      navigation.navigate('Terms');
    } else if (key === 'Privacy') {
      navigation.navigate('Privacy');
    } else if (key === 'MedicalRecordList') {
      navigation.navigate('MedicalRecordList');
    }
  };

  const handleLogout = () => {
    Alert.alert(
      '로그아웃',
      '정말 로그아웃 하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '로그아웃',
          style: 'destructive',
          onPress: () => signOut(),
        },
      ],
    );
  };

  const handleWithdraw = () => {
    Alert.alert(
      '회원 탈퇴',
      '탈퇴하시면 모든 기록이 삭제돼요.\n정말 탈퇴하시겠어요?',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '탈퇴하기',
          style: 'destructive',
          onPress: async () => {
            try {
              // 세션 토큰 확보
              const { data: { session } } = await supabase.auth.getSession();
              if (!session?.access_token) throw new Error('세션 없음');

              // delete-account Edge Function 호출
              // (supabase-js PostgREST hang 버그 우회 + auth.admin.deleteUser 권한 필요)
              const res = await fetch(
                `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`,
                {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                  },
                }
              );

              if (!res.ok) {
                const body = await res.text();
                console.error('[handleWithdraw] edge function 오류:', res.status, body);
                throw new Error('탈퇴 실패');
              }

              // 로컬 세션 정리
              await signOut();
            } catch (e: any) {
              Alert.alert('오류', '탈퇴 처리 중 문제가 생겼어요. 다시 시도해주세요.');
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar showParkinon />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 프로필 컴팩트 카드 */}
        <TouchableOpacity
          style={styles.profileCard}
          onPress={() => navigation.navigate('ProfileEdit')}
          activeOpacity={0.85}
        >
          <View style={styles.profileAvatarWrap}>
            <Ionicons name="person" size={24} color="#FFFFFF" />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user?.name ?? '사용자'}</Text>
            <Text style={styles.profileRole}>{roleName}</Text>
          </View>
          <View style={styles.profileEditRow}>
            <Text style={styles.profileEditText}>프로필 수정</Text>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
          </View>
        </TouchableOpacity>

        {/* 섹션별 메뉴 */}
        {MENU_SECTIONS.map((section) => (
          <View key={section.title}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title.toUpperCase()}</Text>
            </View>
            <View style={styles.sectionCard}>
              {section.items.map((item, index) => (
                <View key={item.key}>
                  <TouchableOpacity
                    style={styles.menuRow}
                    onPress={() => handleMenuPress(item.key)}
                    activeOpacity={0.75}
                  >
                    <View style={[
                      styles.menuIconCircle,
                    ]}>
                      <Ionicons
                        name={item.icon}
                        size={28}
                        color={item.key === 'EmergencyContacts' ? '#F44336' : Colors.primary}
                      />
                    </View>
                    <View style={styles.menuTextWrap}>
                      <Text style={styles.menuLabel}>{item.label}</Text>
                      <Text style={styles.menuDesc}>{item.desc}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
                  </TouchableOpacity>
                  {index < section.items.length - 1 && (
                    <View style={styles.menuDivider} />
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}

        {/* 계정 섹션 */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>계정</Text>
        </View>
        <View style={styles.sectionCard}>
          <TouchableOpacity
            style={styles.menuRow}
            onPress={handleLogout}
            activeOpacity={0.75}
          >
            <View style={styles.menuIconCircle}>
              <Ionicons name="log-out-outline" size={28} color={Colors.text} />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuLabel}>로그아웃</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={styles.menuRow}
            onPress={handleWithdraw}
            activeOpacity={0.75}
          >
            <View style={[styles.menuIconCircle, styles.dangerIconCircle]}>
              <Ionicons name="close-circle-outline" size={28} color={Colors.danger} />
            </View>
            <View style={styles.menuTextWrap}>
              <Text style={[styles.menuLabel, styles.dangerLabel]}>회원탈퇴</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },

  scroll: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  /* 프로필 컴팩트 카드 */
  profileCard: {
    backgroundColor: '#4CAF50',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 70,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 4,
  },
  profileAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  profileRole: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  profileEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  profileEditText: {
    fontSize: 16,
    color: '#FFFFFF',
    fontWeight: '500',
  },

  /* 섹션 헤더 */
  sectionHeader: {
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 4,
    paddingTop: 20,
    paddingBottom: 8,
    zIndex: 1,
  },
  sectionHeaderText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  /* 섹션 카드 */
  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 4,
  },

  /* 메뉴 행 */
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 72,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 16,
  },
  menuIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  dangerIconCircle: {
    backgroundColor: '#FFF0F0',
  },
  menuTextWrap: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  menuDesc: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 20,
  },
  dangerLabel: {
    color: Colors.danger,
  },
});
