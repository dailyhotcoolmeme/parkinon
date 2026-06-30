import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useDialog } from '../../context/DialogContext';

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

const REASONS: { id: string; label: string }[] = [
  { id: 'spam', label: '스팸/홍보' },
  { id: 'abuse', label: '욕설·혐오 표현' },
  { id: 'sexual', label: '음란·선정성' },
  { id: 'misinfo', label: '허위 의료정보' },
  { id: 'defamation', label: '비방·명예훼손' },
  { id: 'etc', label: '기타' },
];

export function ReportSheet({
  visible,
  targetType,
  targetId,
  postId,
  onClose,
  onReported,
}: Props) {
  const dialog = useDialog();
  const padBottom = useBottomSheetPadding(24);
  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(onClose);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        await dialog.alert({ title: '로그인이 필요해요', message: '신고는 로그인 후 이용할 수 있어요.' });
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
        title: '신고가 접수되었어요',
        message: '검토 후 조치하겠습니다.\n불편을 드려 죄송합니다.',
      });
      onReported?.();
    } catch (e: any) {
      await dialog.alert({ title: '오류', message: '신고 접수 중 문제가 생겼어요. 다시 시도해주세요.' });
      console.error('[ReportSheet] submit 오류:', e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
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
              {targetType === 'post' ? '게시글 신고하기' : '댓글 신고하기'}
            </Text>
            <Text style={styles.subtitle}>신고 사유를 선택해주세요</Text>
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
            <Text style={styles.submitText}>{submitting ? '접수 중…' : '신고하기'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.cancelText}>취소</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </Modal>
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
