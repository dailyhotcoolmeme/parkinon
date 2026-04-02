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
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';

type NavigationProp = StackNavigationProp<MenuStackParamList, 'MenuHome'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface MenuItem {
  key: string;
  icon: IoniconName;
  label: string;
  desc: string;
}

const MENU_ITEMS: MenuItem[] = [
  {
    key: 'Records',
    icon: 'bar-chart-outline',
    label: '기록 보기',
    desc: '주간·월간 건강 기록을 확인해요',
  },
  {
    key: 'Settings',
    icon: 'notifications-outline',
    label: '알림 설정',
    desc: '약·운동 알림 시간을 설정해요',
  },
  {
    key: 'MedicationManage',
    icon: 'medkit-outline',
    label: '약 관리',
    desc: '복용 중인 약을 추가·수정해요',
  },
  {
    key: 'FamilyLink',
    icon: 'people-outline',
    label: '가족 연동',
    desc: '보호자와 건강 기록을 공유해요',
  },
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
];

export function MenuScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { user, signOut } = useAuth();

  const roleName = user?.role === 'caregiver' ? '보호자' : '환자';

  const handleMenuPress = (key: string) => {
    if (key === 'Records') {
      navigation.navigate('Records');
    } else if (key === 'Settings') {
      navigation.navigate('Settings');
    } else if (key === 'MedicationManage') {
      navigation.navigate('MedicationManage');
    } else if (key === 'FamilyLink') {
      navigation.navigate('FamilyLink');
    } else if (key === 'Terms' || key === 'Privacy') {
      Alert.alert('준비 중', '해당 화면은 준비 중이에요.');
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
          onPress: () => {
            // TODO: 회원탈퇴 처리
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="메뉴" showClose />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 프로필 히어로 카드 */}
        <View style={styles.profileCard}>
          <View style={styles.profileAvatarWrap}>
            <Ionicons name="person" size={40} color={Colors.primary} />
          </View>
          <Text style={styles.profileName}>{user?.name ?? '사용자'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{roleName}</Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('ProfileEdit')}
            activeOpacity={0.7}
            style={styles.profileEditBtn}
          >
            <Text style={styles.profileEditText}>프로필 수정 →</Text>
          </TouchableOpacity>
        </View>

        {/* 메뉴 아이템 */}
        <View style={styles.sectionGap}>
          {MENU_ITEMS.map((item) => (
            <TouchableOpacity
              key={item.key}
              style={styles.menuCard}
              onPress={() => handleMenuPress(item.key)}
              activeOpacity={0.75}
            >
              <View style={styles.menuIconCircle}>
                <Ionicons name={item.icon} size={28} color={Colors.primary} />
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <Text style={styles.menuDesc}>{item.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
            </TouchableOpacity>
          ))}
        </View>

        {/* 계정 구분선 */}
        <View style={styles.separatorRow}>
          <View style={styles.separatorLine} />
          <Text style={styles.separatorLabel}>계정</Text>
          <View style={styles.separatorLine} />
        </View>

        {/* 계정 섹션 */}
        <View style={styles.accountCard}>
          <TouchableOpacity
            style={styles.accountRow}
            onPress={handleLogout}
            activeOpacity={0.75}
          >
            <View style={styles.accountIconCircle}>
              <Ionicons name="log-out-outline" size={26} color={Colors.text} />
            </View>
            <Text style={styles.accountLabel}>로그아웃</Text>
            <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
          </TouchableOpacity>

          <View style={styles.accountDivider} />

          <TouchableOpacity
            style={styles.accountRow}
            onPress={handleWithdraw}
            activeOpacity={0.75}
          >
            <View style={[styles.accountIconCircle, styles.dangerIconCircle]}>
              <Ionicons name="close-circle-outline" size={26} color={Colors.danger} />
            </View>
            <Text style={[styles.accountLabel, styles.dangerLabel]}>회원탈퇴</Text>
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
    backgroundColor: Colors.background,
  },

  scroll: { flex: 1 },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },

  /* 프로필 히어로 카드 */
  profileCard: {
    backgroundColor: Colors.primary,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
  },
  profileAvatarWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.white,
    marginTop: 12,
  },
  roleBadge: {
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.20)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 5,
  },
  roleBadgeText: {
    fontSize: 16,
    color: Colors.white,
    fontWeight: '600',
  },
  profileEditBtn: {
    marginTop: 16,
    paddingVertical: 4,
  },
  profileEditText: {
    fontSize: 17,
    color: 'rgba(255,255,255,0.80)',
    fontWeight: '500',
  },

  /* 메뉴 아이템 */
  sectionGap: {
    marginTop: 20,
    gap: 12,
  },
  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    minHeight: 84,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  menuIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  menuTextWrap: {
    flex: 1,
  },
  menuLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  menuDesc: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 22,
  },

  /* 계정 구분선 */
  separatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 16,
    gap: 10,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  separatorLabel: {
    fontSize: 15,
    color: Colors.textHint,
    fontWeight: '600',
  },

  /* 계정 카드 */
  accountCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    minHeight: 76,
  },
  accountIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  dangerIconCircle: {
    backgroundColor: '#FFF0F0',
  },
  accountLabel: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: Colors.text,
  },
  dangerLabel: {
    color: Colors.danger,
  },
  accountDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: 20,
  },
});
