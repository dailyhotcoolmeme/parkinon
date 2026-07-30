import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { useDialog } from '../../context/DialogContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useTranslation } from 'react-i18next';
import { isOverseasLocale, legalDocUrl } from '../../i18n/detectLocale';

type Nav = StackNavigationProp<OnboardingStackParamList, 'SensitiveInfoConsent'>;

// 민감정보 동의 버전. 동의 문구/항목 변경 시 1씩 올리면 기존 사용자에게 강제 재동의 요구 가능.
export const SENSITIVE_INFO_CONSENT_VERSION = 1;

// 개인정보 국외 이전 동의 버전. 국외 이전 안내/항목 변경 시 1씩 올리면 기존 사용자에게 강제 재동의 요구.
export const INTERNATIONAL_TRANSFER_CONSENT_VERSION = 1;

// 개인정보처리방침 링크 (자세히 보기)
function getPrivacyPolicyUrl(): string {
  return legalDocUrl('privacy');
}

export function SensitiveInfoConsentScreen() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const navigation = useNavigation<Nav>();
  const dialog = useDialog();
  const bottomPadding = useBottomSheetPadding(32);
  const [agreedHealth, setAgreedHealth] = useState(false);
  const [agreedTransfer, setAgreedTransfer] = useState(false);
  const allAgreed = agreedHealth && agreedTransfer;

  const handleAgree = async () => {
    if (!allAgreed) return;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      const accessToken = sessionData?.session?.access_token;

      if (userId && accessToken) {
        // DB에 계정 단위로 저장 (기기 이전 시에도 유지)
        const res = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              sensitive_info_consented: true,
              sensitive_info_consent_version: SENSITIVE_INFO_CONSENT_VERSION,
              international_transfer_consented: true,
              international_transfer_consent_version: INTERNATIONAL_TRANSFER_CONSENT_VERSION,
            }),
          }
        );
        if (!res.ok) {
          const errText = await res.text();
          console.error('[SensitiveInfoConsent] DB save failed:', res.status, errText);
          dialog.alert({ title: t('sensitiveConsent.errorTitle'), message: t('sensitiveConsent.consentSaveFailMsg') });
          return;
        }
      }

      // AsyncStorage는 캐시로만 사용 (오프라인/빠른 접근용)
      await AsyncStorage.multiSet([
        ['sensitive_info_consented', 'true'],
        ['international_transfer_consented', 'true'],
      ]);
      navigation.replace('FamilyCheck');
    } catch (e) {
      console.error('[SensitiveInfoConsent] handleAgree exception:', e);
      dialog.alert({ title: t('sensitiveConsent.errorTitle'), message: t('sensitiveConsent.consentSaveExceptionMsg') });
    }
  };

  const openPrivacyPolicy = () => {
    Linking.openURL(getPrivacyPolicyUrl()).catch(() => {
      dialog.alert({ title: t('sensitiveConsent.noticeTitle'), message: t('sensitiveConsent.privacyPolicyOpenFailMsg') });
    });
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 헤더 */}
        <View style={styles.header}>
          <Ionicons name="shield-checkmark" size={48} color={Colors.primary} />
          <Text style={styles.title}>{t('sensitiveConsent.headerTitle')}</Text>
          <Text style={styles.subtitle}>
            {t('sensitiveConsent.headerSubtitle')}
          </Text>
        </View>

        {/* 수집 항목 카드 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('sensitiveConsent.collectedInfoTitle')}</Text>
          <View style={styles.itemList}>
            {[
              t('sensitiveConsent.item1'),
              t('sensitiveConsent.item2'),
              t('sensitiveConsent.item3'),
              t('sensitiveConsent.item4'),
            ].map((item) => (
              <View key={item} style={styles.listItem}>
                <View style={styles.bullet} />
                <Text style={styles.listItemText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 처리 방침 카드 */}
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('sensitiveConsent.purposeLabel')}</Text>
            <Text style={styles.infoValue}>{t('sensitiveConsent.purposeValue')}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('sensitiveConsent.retentionLabel')}</Text>
            <Text style={styles.infoValue}>{t('sensitiveConsent.retentionValue')}</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>{t('sensitiveConsent.thirdPartyLabel')}</Text>
            <Text style={styles.infoValue}>{t('sensitiveConsent.thirdPartyValue')}</Text>
          </View>
          {/* 가족 연동은 제3자 제공이 아니라 서비스 기능이지만, "제3자 제공 없음"만 보면
              가족과 기록을 함께 본다는 점을 오해할 수 있어 한 줄로 분명히 안내한다. */}
          <View style={styles.familyShareNote}>
            <Ionicons name="people-outline" size={18} color={Colors.textSub} style={styles.familyShareIcon} />
            <Text style={styles.familyShareText}>
              {t('sensitiveConsent.familyShareNote')}
            </Text>
          </View>
        </View>

        {/* 민감정보 안내 배너 */}
        <View style={styles.warningBanner}>
          <Ionicons name="warning-outline" size={22} color="#F57C00" />
          <Text style={styles.warningText}>
            {t('sensitiveConsent.warningText')}
          </Text>
        </View>

        {/* 국외 이전 안내 카드 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t('sensitiveConsent.transferTitle')}</Text>
          <Text style={styles.transferIntro}>
            {t('sensitiveConsent.transferIntro')}
          </Text>
          <View style={styles.transferList}>
            <View style={styles.transferItem}>
              <Text style={styles.transferLabel}>{t('sensitiveConsent.dataStorageLabel')}</Text>
              <Text style={styles.transferValue}>{t('sensitiveConsent.dataStorageValue')}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.transferItem}>
              <Text style={styles.transferLabel}>{t('sensitiveConsent.mediaStorageLabel')}</Text>
              <Text style={styles.transferValue}>{t('sensitiveConsent.mediaStorageValue')}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.transferItem}>
              <Text style={styles.transferLabel}>{t('sensitiveConsent.ocrLabel')}</Text>
              <Text style={styles.transferValue}>{t('sensitiveConsent.ocrValue')}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={openPrivacyPolicy} activeOpacity={0.7} style={styles.policyLinkRow}>
            <Ionicons name="document-text-outline" size={18} color={Colors.primary} />
            <Text style={styles.policyLinkText}>{t('sensitiveConsent.policyLinkText')}</Text>
          </TouchableOpacity>
        </View>

        {/* 동의 체크박스 ① 건강 정보 */}
        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setAgreedHealth(!agreedHealth)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, agreedHealth && styles.checkboxActive]}>
            {agreedHealth && (
              <Ionicons name="checkmark" size={20} color={Colors.white} />
            )}
          </View>
          <Text style={styles.checkLabel}>
            {t('sensitiveConsent.checkHealthLabel')}{' '}
            <Text style={styles.required}>{t('sensitiveConsent.requiredLabel')}</Text>
          </Text>
        </TouchableOpacity>

        {/* 동의 체크박스 ② 국외 이전 */}
        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setAgreedTransfer(!agreedTransfer)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, agreedTransfer && styles.checkboxActive]}>
            {agreedTransfer && (
              <Ionicons name="checkmark" size={20} color={Colors.white} />
            )}
          </View>
          <Text style={styles.checkLabel}>
            {t('sensitiveConsent.checkTransferLabel')}{' '}
            <Text style={styles.required}>{t('sensitiveConsent.requiredLabel')}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 하단 버튼 영역 */}
      <View style={[styles.bottomArea, { paddingBottom: bottomPadding }]}>
        <TouchableOpacity
          style={[styles.agreeBtn, !allAgreed && styles.agreeBtnDisabled]}
          onPress={handleAgree}
          activeOpacity={allAgreed ? 0.85 : 1}
          disabled={!allAgreed}
        >
          <Text style={[styles.agreeBtnText, !allAgreed && styles.agreeBtnTextDisabled]}>
            {t('sensitiveConsent.agreeBtn')}
          </Text>
        </TouchableOpacity>
        <Text style={styles.noticeText}>{t('sensitiveConsent.noticeBottom')}</Text>
        {/* 이탈 수단 — 동의 안 할 경우 로그아웃으로 나갈 수 있게(다른 온보딩 화면과 통일). */}
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={async () => {
            const ok = await dialog.confirm({
              title: t('sensitiveConsent.exitTitle'),
              message: t('sensitiveConsent.exitMsg'),
              confirmText: t('common.close'),
              cancelText: t('common.cancel'),
            });
            if (ok) signOut();
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.closeBtnText}>{t('common.close')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 16,
  },

  /* 헤더 */
  header: {
    alignItems: 'center',
    marginBottom: 28,
    paddingTop: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 14,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 28,
  },

  /* 카드 */
  card: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.07,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 16,
  },

  /* 리스트 아이템 */
  itemList: {
    gap: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    flexShrink: 0,
  },
  listItemText: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 26,
    flex: 1,
  },

  /* 처리 방침 행 */
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
  },
  infoLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
    width: 80,
    flexShrink: 0,
  },
  infoValue: {
    fontSize: 16,
    color: Colors.text,
    flex: 1,
    lineHeight: 24,
  },
  infoDivider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  /* 가족 연동 공유 안내 (오해 방지) */
  familyShareNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  familyShareIcon: {
    marginTop: 2,
    flexShrink: 0,
  },
  familyShareText: {
    flex: 1,
    fontSize: 15,
    color: Colors.textSub,
    lineHeight: 22,
  },

  /* 경고 배너 */
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8E1',
    borderRadius: 10,
    padding: 14,
    gap: 10,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  warningText: {
    fontSize: 16,
    color: '#F57C00',
    lineHeight: 24,
    flex: 1,
  },

  /* 국외 이전 안내 */
  transferIntro: {
    fontSize: 17,
    color: Colors.text,
    lineHeight: 27,
    marginBottom: 16,
  },
  transferList: {
    marginBottom: 14,
  },
  transferItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    gap: 12,
  },
  transferLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
    width: 110,
    flexShrink: 0,
  },
  transferValue: {
    fontSize: 16,
    color: Colors.text,
    flex: 1,
    lineHeight: 24,
  },
  policyLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
  },
  policyLinkText: {
    fontSize: 15,
    color: Colors.primary,
    flex: 1,
    lineHeight: 22,
  },

  /* 체크박스 행 */
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    marginBottom: 8,
  },
  checkbox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    flexShrink: 0,
  },
  checkboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkLabel: {
    fontSize: 18,
    color: Colors.text,
    flex: 1,
    lineHeight: 26,
  },
  required: {
    color: Colors.danger,
    fontWeight: '700',
  },

  /* 하단 버튼 영역 */
  bottomArea: {
    padding: 24,
    // paddingBottom 은 useBottomSheetPadding() 훅 값으로 인라인 지정(안드 3버튼 잘림 방지·글로벌 규칙)
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  agreeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  agreeBtnDisabled: {
    backgroundColor: '#BDBDBD',
  },
  agreeBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.white,
  },
  agreeBtnTextDisabled: {
    color: '#F5F5F5',
  },
  noticeText: {
    fontSize: 14,
    color: Colors.textHint,
    textAlign: 'center',
    lineHeight: 20,
  },
  closeBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
  },
});
