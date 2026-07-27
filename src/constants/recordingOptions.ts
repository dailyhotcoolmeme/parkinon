// 음성 녹음 품질 설정 (일기 음성메모 · 가족 목소리 알림음 공통).
//
// 기존에는 Audio.RecordingOptionsPresets.HIGH_QUALITY(44.1kHz / 스테레오 / AAC 128kbps)를
// 그대로 썼다. 말소리 녹음에는 과한 설정이고, 사진·영상과 달리 업로드 전 압축 단계가 없어
// 원본이 그대로 R2 로 올라간다(약 1MB/분). 60대 사용자의 데이터 요금·업로드 시간에도 직결된다.
//
// → 모노 + 64kbps 로 낮춘다(약 0.5MB/분, 절반 이하). 말소리 명료도 차이는 사실상 없다.
//
// ⚠️ 샘플레이트는 44100 을 유지한다. 가족 목소리 알림음은 iOS 에서 네이티브 모듈이
//    IMA4 CAF(44100Hz mono)로 변환해 Library/Sounds 에 설치하는데(src/lib/alarmSound.ts),
//    입력 샘플레이트를 바꾸면 그 변환 경로의 검증 부담이 생긴다. 용량 절감은 채널/비트레이트로
//    충분히 얻으므로 굳이 건드리지 않는다.
import { Audio } from 'expo-av';

export const VOICE_RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};
