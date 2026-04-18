import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export const useFamilyLink = () => {
  const { user, patientId } = useAuth();
  const [loading, setLoading] = useState(false);

  // 초대 코드 생성 (6자리, 24시간 유효)
  const generateInviteCode = useCallback(async () => {
    if (!user || !patientId) return null;
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error } = await supabase.from('invite_codes').insert({
      code,
      created_by: user.id,
      patient_id: patientId,
      expires_at: expiresAt,
    });

    if (error) return null;
    return code;
  }, [user, patientId]);

  // 초대 코드 입력 (보호자가 입력)
  const enterInviteCode = useCallback(async (code: string) => {
    if (!user) return { success: false, message: '로그인이 필요해요.' };
    setLoading(true);

    try {
      const { data: invite } = await supabase
        .from('invite_codes')
        .select('*')
        .eq('code', code.toUpperCase())
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (!invite) return { success: false, message: '유효하지 않은 코드예요. 다시 확인해주세요.' };

      // 그룹 조회 or 생성
      let { data: group } = await supabase
        .from('patient_groups')
        .select('id')
        .eq('patient_id', invite.patient_id)
        .single();

      if (!group) {
        const { data: newGroup } = await supabase
          .from('patient_groups')
          .insert({ patient_id: invite.patient_id })
          .select()
          .single();
        group = newGroup;
      }

      // 멤버 추가
      await supabase.from('patient_group_members').upsert({
        group_id: group!.id,
        user_id: user.id,
      });

      // 코드 사용 처리
      await supabase.from('invite_codes').update({ used_at: new Date().toISOString() }).eq('code', code);

      return { success: true, message: '가족 연동이 완료됐어요.' };
    } catch {
      return { success: false, message: '연동 중 오류가 발생했어요.' };
    } finally {
      setLoading(false);
    }
  }, [user]);

  // 연결 해제
  const unlinkFamily = useCallback(async (targetUserId: string, groupId: string) => {
    await supabase.from('patient_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', targetUserId);
  }, []);

  return { generateInviteCode, enterInviteCode, unlinkFamily, loading };
};
