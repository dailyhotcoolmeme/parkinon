/**
 * alarm-sound — iOS 가족 목소리 알림음 설치 네이티브 모듈(Expo local module) JS 인터페이스.
 *
 * iOS 전용. m4a 녹음을 IMA4 caf(44100Hz, mono, ≤30초)로 기기에서 변환해
 * Library/Sounds/<name> 에 설치한다. 푸시 payload 의 sound 필드에 <name> 을
 * 지정하면 그 목소리로 알림이 울린다.
 *
 * ⚠️ 네이티브 모듈이므로 새 빌드 전(현재 OTA 런타임)에는 모듈이 없다.
 *    requireOptionalNativeModule 로 안전하게 가드 → 미존재 시 isAvailable=false,
 *    모든 함수는 호출돼도 크래시 없이 no-op/reject 처리.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

interface AlarmSoundNativeModule {
  installSound(sourcePath: string, name: string): Promise<string>;
  removeSound(name: string): Promise<void>;
  listSounds(): Promise<string[]>;
}

const nativeModule = requireOptionalNativeModule<AlarmSoundNativeModule>('AlarmSound');

/** 네이티브 모듈(=새 빌드에 포함된 iOS 알림음 모듈) 사용 가능 여부. */
export const isAvailable: boolean = nativeModule != null;

/**
 * 로컬 오디오(m4a)를 iOS 알림음 규격 caf 로 변환해 Library/Sounds/<name> 에 설치.
 * @param sourcePath 로컬 파일 경로(file:// 또는 절대경로)
 * @param name 설치 파일명(예: `parkinon_<soundId>.caf`)
 * @returns 설치된 파일명
 */
export async function installSound(sourcePath: string, name: string): Promise<string> {
  if (!nativeModule) {
    throw new Error('AlarmSound native module unavailable (requires new build)');
  }
  return nativeModule.installSound(sourcePath, name);
}

/** Library/Sounds/<name> 제거(정리용). 모듈 미존재 시 조용히 no-op. */
export async function removeSound(name: string): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.removeSound(name);
}

/** 현재 설치된 알림음 파일명 목록. 모듈 미존재 시 빈 배열. */
export async function listSounds(): Promise<string[]> {
  if (!nativeModule) return [];
  return nativeModule.listSounds();
}
