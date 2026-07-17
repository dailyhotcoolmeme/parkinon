// "알람처럼(전체화면·끌 때까지)" / "30초" 알림을 위한 네이티브 설정.
//  - USE_FULL_SCREEN_INTENT: 잠금화면 위 전체화면 알람(notifee fullScreenAction).
//  - USE_EXACT_ALARM/SCHEDULE_EXACT_ALARM: 정확한 시각 로컬 알람(파킨온=복약 리마인더 앱이라 정책상 허용).
//  - WAKE_LOCK: 알람 시 화면 깨우기.
//  - FOREGROUND_SERVICE(+SHORT_SERVICE): 울리는 동안 소리 반복(notifee asForegroundService).
//  - MainActivity 에 showWhenLocked/turnScreenOn → full-screen intent 가 잠금화면 위로 켜지게.
// ⚠️ prebuild(--clean) 후 반영. app.json plugins 에 등록되어야 동작(OTA 불가·재빌드 필요).
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

const PERMISSIONS = [
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_EXACT_ALARM',
  'android.permission.WAKE_LOCK',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SHORT_SERVICE',
  'android.permission.VIBRATE',
];

function withAlarmPermissions(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const existing = new Set(
      manifest['uses-permission'].map((p) => p.$ && p.$['android:name']).filter(Boolean),
    );
    for (const perm of PERMISSIONS) {
      if (!existing.has(perm)) {
        manifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    }
    return cfg;
  });
}

// MainActivity 가 잠금화면 위로 표시되고 화면을 켜도록(full-screen intent 목적).
function withMainActivityLockScreen(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    const activities = app.activity || [];
    const main = activities.find(
      (a) => a.$ && a.$['android:name'] === '.MainActivity',
    );
    if (main) {
      main.$['android:showWhenLocked'] = 'true';
      main.$['android:turnScreenOn'] = 'true';
    }
    return cfg;
  });
}

module.exports = function withAlarmFullScreen(config) {
  config = withAlarmPermissions(config);
  config = withMainActivityLockScreen(config);
  return config;
};
