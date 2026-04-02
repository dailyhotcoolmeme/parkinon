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
import { useAuth } from '../../context/AuthContext';

type NavigationProp = StackNavigationProp<MenuStackParamList, 'MenuHome'>;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const MENU_ITEMS: { key: string; icon: IoniconName; label: string }[] = [
  { key: 'Records', icon: 'bar-chart-outline', label: '기록 보기' },
  { key: 'Settings', icon: 'settings-outline', label: '설정' },
  { key: 'MedicationManage', icon: 'medkit-outline', label: '약 관리' },
  { key: 'FamilyLink', icon: 'people-outline', label: '가족 연동' },
  { key: 'Terms', icon: 'document-text-outline', label: '이용약관' },
  { key: 'Privacy', icon: 'lock-closed-outline', label: '개인정보처리방침' },
];

export function MenuScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { user, signOut } = useAuth();

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
    <SafeAreaView style={styles.safeArea}>
      {/* 탑바 */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>메뉴</Text>
        <View style={styles.topBarRight} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 프로필 카드 */}
        <TouchableOpacity
          style={styles.profileCard}
          onPress={() => navigation.navigate('ProfileEdit')}
          activeOpacity={0.8}
        >
          <View style={styles.profileLeft}>
            <View style={styles.profileAvatar}>
              <Ionicons name="person" size={28} color={Colors.dark} />
            </View>
            <View>
              <Text style={styles.profileName}>
                {user?.name ?? '사용자'} / {user?.role === 'caregiver' ? '보호자' : '환자'}
              </Text>
              <Text style={styles.profileEdit}>프로필 수정 →</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* 보호자 정보 카드 */}
        <View style={styles.caregiverCard}>
          <View style={styles.caregiverHeader}>
            <View style={styles.caregiverTitleRow}>
              <Ionicons name="people-outline" size={18} color={Colors.text} />
              <Text style={styles.caregiverTitle}>보호자 정보</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('FamilyLink')}>
              <Text style={styles.caregiverLink}>관리 →</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.caregiverDesc}>가족과 연동하면 보호자가 복용·운동 기록을 함께 확인할 수 있어요.</Text>
          <TouchableOpacity
            style={styles.caregiverBtn}
            onPress={() => navigation.navigate('FamilyLink')}
            activeOpacity={0.8}
          >
            <Text style={styles.caregiverBtnText}>가족 연동하기</Text>
          </TouchableOpacity>
        </View>

        {/* 메뉴 리스트 */}
        <View style={styles.menuList}>
          {MENU_ITEMS.map((item, i) => (
            <TouchableOpacity
              key={item.key}
              style={[styles.menuRow, i < MENU_ITEMS.length - 1 && styles.menuRowBorder]}
              onPress={() => handleMenuPress(item.key)}
              activeOpacity={0.7}
            >
              <Ionicons name={item.icon} size={22} color={Colors.text} style={styles.menuIcon} />
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={20} color={Colors.textHint} />
            </TouchableOpacity>
          ))}
        </View>

        {/* 구분선 */}
        <View style={styles.divider} />

        {/* 로그아웃 */}
        <TouchableOpacity style={styles.menuRow} onPress={handleLogout} activeOpacity={0.7}>
          <Ionicons name="log-out-outline" size={22} color={Colors.text} style={styles.menuIcon} />
          <Text style={styles.menuLabel}>로그아웃</Text>
        </TouchableOpacity>

        {/* 회원탈퇴 */}
        <TouchableOpacity style={styles.menuRow} onPress={handleWithdraw} activeOpacity={0.7}>
          <Ionicons name="close-circle-outline" size={22} color={Colors.danger} style={styles.menuIcon} />
          <Text style={[styles.menuLabel, styles.menuLabelDanger]}>회원탈퇴</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

  topBar: {
    height: 60,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  closeBtn: { width: 48, alignItems: 'flex-start', padding: 8 },
  topBarTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  topBarRight: { width: 48 },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  profileCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  profileLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  profileEdit: { fontSize: 17, color: Colors.primary, fontWeight: '600' },

  menuList: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    backgroundColor: Colors.white,
  },
  menuRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  menuIcon: { marginRight: 16 },
  menuLabel: { flex: 1, fontSize: 18, color: Colors.text, fontWeight: '500' },
  menuLabelDanger: { color: Colors.danger },

  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 8 },

  caregiverCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  caregiverHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  caregiverTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  caregiverTitle: { fontSize: 19, fontWeight: '700', color: Colors.text },
  caregiverLink: { fontSize: 17, color: Colors.primary, fontWeight: '600' },
  caregiverDesc: { fontSize: 17, color: Colors.textSub, lineHeight: 26, marginBottom: 14 },
  caregiverBtn: {
    backgroundColor: Colors.light,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  caregiverBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
});
