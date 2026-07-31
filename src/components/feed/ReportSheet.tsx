import React, { useState, useEffect } from 'react';
import { OverlaySheet } from '../common/OverlaySheet';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useDialog } from '../../context/DialogContext';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

export type ReportTargetType = 'post' | 'comment';

interface Props {
  visible: boolean;
  targetType: ReportTargetType;
  targetId: string;
  /** 댓글 신고 시 소속 게시글 id (게시글 신고면 자기 자신) */
  postId?: string;
  onClose: () => void;
  /** 신고 접수 완료 후 호출 (선택) */
  onReported?: () => void;
}

function getReasons(): { id: string; label: string }[] {
  return [
    { id: 'spam', label: i18n.t('reportSheet.reasonSpam') },
    { id: 'abuse', label: i18n.t('reportSheet.reasonAbuse') },
    { id: 'sexual', label: i18n.t('reportSheet.reasonSexual') },
    { id: 'misinfo', label: i18n.t('reportSheet.reasonMisinfo') },
    { id: 'defamation', label: i18n.t('reportSheet.reasonDefamation') },
    { id: 'etc', label: i18n.t('reportSheet.reasonEtc') },
  ];
}

export function ReportSheet({
  visible,
  targetType,
  targetId,
  postId,
  onClose,
  onReported,
}: Props) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const padBottom = useBottomSheetPadding(24);
  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(onClose);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const REASONS = getReasons();

  useEffect(() => {
    if (visible) {
      setSelected(null);
      resetPosition();
    }
  }, [visible]);

  const handleSubmit = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        await dialog.alert({ title: t('reportSheet.loginRequiredTitle'), message: t('reportSheet.loginRequiredMsg') });
        return;
      }
      const reasonLabel = REASONS.find(r => r.id === selected)?.label ?? selected;
      const { error } = await supabase.from('post_reports').insert({
        reporter_id: session.user.id,
        target_type: targetType,
        target_id: targetId,
        post_id: postId ?? null,
        reason: reasonLabel,
      });
      // 23505 = 이미 신고한 항목(unique 위반) — 동일하게 접수 안내
      if (error && error.code !== '23505') throw error;
      onClose();
      await dialog.alert({
        title: t('reportSheet.submittedTitle'),
        message: t('reportSheet.submittedMsg'),
      });
      onReported?.();
    } catch (e: any) {
      await dialog.alert({ title: t('reportSheet.errorTitle'), message: t('reportSheet.errorMsg') });
      console.error('[ReportSheet] submit 오류:', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <OverlaySheet visible={visible} onRequestClose={onClose} animationType="fade">
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTouch} activeOpacity={1} onPress={onClose} />
        <Animated.View
          style={[styles.sheet, { paddingBottom: padBottom, transform: [{ translateY }] }]}
        >
          {/* 드래그 핸들 + 제목 영역에만 스와이프-닫기 부착 (내부 사유 리스트 스크롤과 충돌 방지) */}
          <View {...panHandlers}>
            {/* 드래그 핸들 */}
            <View style={styles.handle} />

            <Text style={styles.title}>
              {targetType === 'post' ? t('reportSheet.reportPostTitle') : t('reportSheet.reportCommentTitle')}
            </Text>
            <Text style={styles.subtitle}>{t('reportSheet.selectReason')}</Text>
          </View>

          <ScrollView style={styles.reasonScroll} bounces={false}>
            {REASONS.map((r) => {
              const active = selected === r.id;
              return (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.reasonRow, active && styles.reasonRowActive]}
                  onPress={() => setSelected(r.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.reasonText, active && styles.reasonTextActive]}>
                    {r.label}
                  </Text>
                  <Ionicons
                    name={active ? 'checkmark-circle' : 'ellipse-outline'}
                    size={26}
                    color={active ? Colors.primary : '#CCCCCC'}
                  />
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity
            style={[styles.submitBtn, (!selected || submitting) && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!selected || submitting}
            activeOpacity={0.85}
          >
            <Ionicons name="flag" size={20} color={Colors.white} />
            <Text style={styles.submitText}>{submitting ? t('reportSheet.submitting') : t('reportSheet.submitBtn')}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.cancelText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  backdropTouch: { flex: 1 },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 20,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#DDDDDD',
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  subtitle: { fontSize: 16, color: Colors.textSub, textAlign: 'center', marginTop: 6, marginBottom: 16 },
  reasonScroll: { maxHeight: 360 },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 60,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    marginBottom: 10,
  },
  reasonRowActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  reasonText: { fontSize: 18, color: Colors.text, fontWeight: '500' },
  reasonTextActive: { color: Colors.dark, fontWeight: '700' },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: Colors.danger,
    marginTop: 8,
  },
  submitBtnDisabled: { backgroundColor: '#E0A9A4' },
  submitText: { fontSize: 19, fontWeight: '700', color: Colors.white },
  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    marginTop: 8,
  },
  cancelText: { fontSize: 18, color: Colors.textSub, fontWeight: '600' },
});
