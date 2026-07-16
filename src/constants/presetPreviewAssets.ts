/**
 * 프리셋 알림음 미리듣기용 로컬 에셋 (정적 require).
 *
 * - 앱 내 미리듣기는 번들 자산이 아니라 이 mp3 를 expo-av 로 재생한다(iOS·안드 공통).
 *   → 알림 실제 재생(네이티브 번들 caf/res-raw)과 별개. 미리듣기는 재빌드 전 OTA 에서도 동작.
 * - require 경로는 반드시 정적 문자열이어야 하므로(메트로 번들러) 12개를 명시 나열한다.
 */
export const PRESET_PREVIEW_ASSETS: Record<string, number> = {
  preset_knock: require('../../assets/alarm-presets/android/preset_knock.mp3'),
  preset_waterdrop: require('../../assets/alarm-presets/android/preset_waterdrop.mp3'),
  preset_shortloop: require('../../assets/alarm-presets/android/preset_shortloop.mp3'),
  preset_dreamy: require('../../assets/alarm-presets/android/preset_dreamy.mp3'),
  preset_bouncy: require('../../assets/alarm-presets/android/preset_bouncy.mp3'),
  preset_dramatic: require('../../assets/alarm-presets/android/preset_dramatic.mp3'),
  preset_cheerful: require('../../assets/alarm-presets/android/preset_cheerful.mp3'),
  preset_trot: require('../../assets/alarm-presets/android/preset_trot.mp3'),
  preset_calm: require('../../assets/alarm-presets/android/preset_calm.mp3'),
  preset_ballad: require('../../assets/alarm-presets/android/preset_ballad.mp3'),
  preset_lullaby: require('../../assets/alarm-presets/android/preset_lullaby.mp3'),
  preset_sitcom: require('../../assets/alarm-presets/android/preset_sitcom.mp3'),
};
