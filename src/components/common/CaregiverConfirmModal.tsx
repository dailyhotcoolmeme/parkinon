import React from 'react';
import { OverlaySheet } from './OverlaySheet';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  visible: boolean;
  patientName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 보호자 모드: "홍길동님 대신 입력하시나요?" 확인 팝업
 * 함께 거주 보호자가 버튼 탭할 때 표시
 */
export function CaregiverConfirmModal({
  visible,
  patientName,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const name = patientName ?? t('medication.caregiverDefaultName');
  return (
    <OverlaySheet visible={visible} onRequestClose={onCancel} animationType="fade">
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onCancel}
      />
      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <Text style={styles.emoji}>👨‍👩‍👧</Text>
          <Text style={styles.title}>{t('medication.caregiverConfirmTitle', { name })}</Text>
          <Text style={styles.subtitle}>
            {t('medication.caregiverConfirmSubtitle')}
          </Text>

          <View style={styles.btnRow}>
            <PrimaryButton
              title={t('medication.caregiverConfirmYes')}
              onPress={onConfirm}
            />
          </View>

          <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
            <Text style={styles.cancelText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  emoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSub,
    textAlign: 'center',
    marginBottom: 24,
  },
  btnRow: {
    width: '100%',
    marginBottom: 8,
  },
  cancelBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    color: Colors.textSub,
    fontWeight: '600',
  },
});
