import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

const MAX_DURATION_SECONDS = 120; // 2분

export const useVideoUpload = () => {
  const { patientId } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickVideo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsEditing: false,
      quality: 1,
    });

    if (result.canceled) return null;

    const asset = result.assets[0];

    // duration 체크 (2분 초과 시 차단)
    if (asset.duration && asset.duration > MAX_DURATION_SECONDS * 1000) {
      setError('영상은 최대 2분까지 업로드할 수 있어요.');
      return null;
    }

    return asset;
  };

  const recordVideo = async () => {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: MAX_DURATION_SECONDS,
      quality: ImagePicker.UIImagePickerControllerQualityType.Low,
    });

    if (result.canceled) return null;
    return result.assets[0];
  };

  const uploadVideo = async (uri: string) => {
    if (!patientId) return null;
    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', { uri, type: 'video/mp4', name: 'video.mp4' } as any);
      formData.append('patientId', patientId);
      formData.append('type', 'video');

      const { data, error } = await supabase.functions.invoke('r2-upload', { body: formData });
      if (error) throw error;

      // media_logs 저장
      await supabase.from('media_logs').insert({
        patient_id: patientId,
        r2_url: data.url,
        recorded_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), // 6개월
      });

      return data.url;
    } catch (err: any) {
      setError(err.message);
      return null;
    } finally {
      setUploading(false);
    }
  };

  return { pickVideo, recordVideo, uploadVideo, uploading, error };
};
