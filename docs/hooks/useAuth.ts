import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export const useAuth = () => {
  const [user, setUser] = useState<any>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [role, setRole] = useState<'patient' | 'caregiver' | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchUserProfile(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchUserProfile(session.user.id);
      else { setRole(null); setPatientId(null); }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserProfile = async (userId: string) => {
    const { data } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();
    setRole(data?.role ?? null);

    // 환자이면 본인이 patientId, 보호자이면 연동된 환자 ID 조회
    if (data?.role === 'patient') {
      setPatientId(userId);
    } else {
      const { data: group } = await supabase
        .from('patient_group_members')
        .select('patient_groups(patient_id)')
        .eq('user_id', userId)
        .single();
      setPatientId((group as any)?.patient_groups?.patient_id ?? null);
    }
    setLoading(false);
  };

  return { user, patientId, role, loading };
};
