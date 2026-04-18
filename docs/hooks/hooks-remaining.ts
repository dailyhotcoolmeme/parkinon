// useExercise.ts
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export const useExercise = () => {
  const { user, patientId } = useAuth();
  const [loading, setLoading] = useState(false);

  const saveExercise = useCallback(async (
    exerciseType: string,
    durationMinutes: number,
    isProxy = false
  ) => {
    if (!patientId || !user) return false;
    setLoading(true);
    try {
      const { error } = await supabase.from('exercise_logs').insert({
        patient_id: patientId,
        exercise_type: exerciseType,
        duration_minutes: durationMinutes,
        exercised_at: new Date().toISOString(),
        recorded_by: user.id,
        is_proxy: isProxy,
      });
      return !error;
    } finally {
      setLoading(false);
    }
  }, [patientId, user]);

  const fetchTodayExercises = useCallback(async () => {
    if (!patientId) return [];
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('exercise_logs')
      .select('*')
      .eq('patient_id', patientId)
      .gte('exercised_at', `${today}T00:00:00`)
      .order('exercised_at');
    return data ?? [];
  }, [patientId]);

  return { saveExercise, fetchTodayExercises, loading };
};

// useFeed.ts
import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const PAGE_SIZE = 20;

export const useFeed = () => {
  const [posts, setPosts] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchPosts = useCallback(async (reset = false) => {
    setLoading(true);
    const currentPage = reset ? 0 : page;
    try {
      const { data } = await supabase
        .from('posts')
        .select('*, author:users(name, role), media:post_media(*)')
        .order('created_at', { ascending: false })
        .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1);

      if (reset) setPosts(data ?? []);
      else setPosts((prev) => [...prev, ...(data ?? [])]);

      setHasMore((data?.length ?? 0) === PAGE_SIZE);
      setPage(currentPage + 1);
    } finally {
      setLoading(false);
    }
  }, [page]);

  return { posts, fetchPosts, hasMore, loading };
};

// useRecords.ts
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { calcTrend } from '../utils/calcTrend';

export const useRecords = () => {
  const { patientId } = useAuth();

  const fetchWeeklySummary = useCallback(async () => {
    if (!patientId) return null;
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1);
    startOfWeek.setHours(0, 0, 0, 0);

    const { data } = await supabase
      .from('on_off_logs')
      .select('*')
      .eq('patient_id', patientId)
      .eq('triggered_by', 'notification') // 약효 패턴은 알림 통해 입력만
      .gte('recorded_at', startOfWeek.toISOString());

    return data;
  }, [patientId]);

  return { fetchWeeklySummary };
};

// usePrescriptionOCR.ts
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { maskPersonalInfo } from '../utils/maskPersonalInfo';

export const usePrescriptionOCR = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeImage = async (base64Image: string) => {
    setLoading(true);
    setError(null);
    try {
      const masked = maskPersonalInfo(base64Image);
      const { data, error } = await supabase.functions.invoke('ocr-prescription', {
        body: { image: masked },
      });
      if (error) throw error;
      return data.medications; // [{ name, dosage, frequency, timeSlots }]
    } catch (err: any) {
      setError('처방전을 인식하지 못했어요. 다시 찍어보시거나 직접 입력해주세요.');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { analyzeImage, loading, error };
};

// useYoutubeMeta.ts
import { useState } from 'react';

export const useYoutubeMeta = () => {
  const [loading, setLoading] = useState(false);

  const extractVideoId = (url: string) => {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|watch\?v=))([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  const fetchMeta = async (url: string) => {
    const videoId = extractVideoId(url);
    if (!videoId) return null;
    setLoading(true);
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      const data = await res.json();
      return {
        videoId,
        title: data.title,
        thumbnail: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      };
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { fetchMeta, extractVideoId, loading };
};

// useNotification.ts
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

export const useNotification = () => {
  const requestPermission = async () => {
    if (!Device.isDevice) return false;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  };

  const scheduleDaily = async (
    hour: number,
    minute: number,
    title: string,
    body: string,
    data: object
  ) => {
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, data },
      trigger: { hour, minute, repeats: true },
    });
  };

  const cancelNotification = async (id: string) => {
    await Notifications.cancelScheduledNotificationAsync(id);
  };

  return { requestPermission, scheduleDaily, cancelNotification };
};
