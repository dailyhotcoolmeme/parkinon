import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// 환자 ID 반환 훅 — 환자면 본인, 보호자면 그룹에서 환자 조회
export function usePatientId(): { patientId: string | null; loading: boolean } {
  const { user } = useAuth();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setPatientId(null); setLoading(false); return; }
    if (user.role === 'patient') { setPatientId(user.id); setLoading(false); return; }

    if (!user.patient_group_id) { setPatientId(null); setLoading(false); return; }

    supabase
      .from('patient_group_members')
      .select('user_id')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single()
      .then(({ data }) => {
        setPatientId(data?.user_id ?? null);
        setLoading(false);
      });
  }, [user]);

  return { patientId, loading };
}
