// formatDate.ts
export const formatDate = (date: Date): string => {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayOfWeek = days[date.getDay()];
  return `${year}년\n${month}월 ${day}일 (${dayOfWeek})`;
};

// calcTrend.ts
export const calcTrend = (values: number[]) => {
  if (values.length < 2) return 0;
  return values[values.length - 1] - values[values.length - 2];
};

export const trendLabel = (diff: number, unit = '점') => {
  if (Math.abs(diff) < 0.1) return '→ 유지';
  if (diff > 0) return `↑ ${Math.abs(diff).toFixed(1)}${unit} 상승`;
  return `↓ ${Math.abs(diff).toFixed(1)}${unit} 하락`;
};

export const trendColor = (diff: number) => {
  if (Math.abs(diff) < 0.1) return '#999999';
  return diff > 0 ? '#4CAF50' : '#F44336';
};

// getMedTimeLabel.ts
export const getMedTimeLabel = (date: Date): 'morning' | 'lunch' | 'evening' | 'bedtime' => {
  const hour = date.getHours();
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 21) return 'evening';
  return 'bedtime';
};

export const getMedTimeKorean = (slot: string) => {
  const map: Record<string, string> = {
    morning: '아침',
    lunch: '점심',
    evening: '저녁',
    bedtime: '취침',
  };
  return map[slot] ?? slot;
};

// checkDuplicate.ts
interface Med { name: string; dosage: string; time_slots: any[] }

export const checkDuplicate = (medications: Med[]): string[] => {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];

  medications.forEach((med) => {
    const key = `${med.name}-${med.dosage}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  });

  seen.forEach((count, key) => {
    if (count > 1) duplicates.push(key.split('-')[0]);
  });

  return duplicates;
};

// maskPersonalInfo.ts
// 처방전 이미지에서 개인정보 마스킹 (서버사이드에서 처리)
// 클라이언트에서는 이미지를 base64로 변환만 하고 서버에서 마스킹
export const imageToBase64 = async (uri: string): Promise<string> => {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
};

export const maskPersonalInfo = (base64: string): string => {
  // 실제 마스킹은 Supabase Edge Function에서 처리
  // 여기서는 그대로 반환
  return base64;
};

// compressVideo.ts
// expo-video-manipulator 또는 ffmpeg-kit-react-native 사용
export const compressVideo = async (uri: string): Promise<string> => {
  // TODO: 실제 압축 구현
  // 현재는 원본 URI 반환
  // 추후 ffmpeg-kit-react-native 사용하여 압축
  return uri;
};
