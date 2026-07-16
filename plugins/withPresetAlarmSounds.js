// 프리셋 알림음(12개)을 네이티브 빌드에 번들한다(포맷이 플랫폼별로 달라 expo-notifications
// sounds 배열로는 불가 → 커스텀 플러그인).
//  - Android: assets/alarm-presets/android/<id>.mp3 → android/app/src/main/res/raw/<id>.mp3
//             (알림 채널 sound 를 raw 리소스명 '<id>' 로 참조)
//  - iOS:     assets/alarm-presets/ios/<id>.caf → 앱 번들(Copy Bundle Resources)
//             (UNNotificationSound(named:'<id>.caf') 로 참조)
// ⚠️ prebuild(--clean) 후 반영. app.json plugins 에 등록되어야 동작.
const { withDangerousMod, withXcodeProject, IOSConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ANDROID_SRC = 'assets/alarm-presets/android'; // *.mp3
const IOS_SRC = 'assets/alarm-presets/ios'; // *.caf

function listFiles(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext));
}

// Android: mp3 → res/raw
function withAndroidRawSounds(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const srcDir = path.join(cfg.modRequest.projectRoot, ANDROID_SRC);
      const rawDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
      fs.mkdirSync(rawDir, { recursive: true });
      for (const f of listFiles(srcDir, '.mp3')) {
        fs.copyFileSync(path.join(srcDir, f), path.join(rawDir, f));
      }
      return cfg;
    },
  ]);
}

// iOS: caf → 앱 번들
function withIosBundleSounds(config) {
  // 1) 파일을 ios/<projName>/ 로 복사
  config = withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const srcDir = path.join(cfg.modRequest.projectRoot, IOS_SRC);
      const projName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
      const destDir = path.join(cfg.modRequest.platformProjectRoot, projName);
      fs.mkdirSync(destDir, { recursive: true });
      for (const f of listFiles(srcDir, '.caf')) {
        fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
      }
      return cfg;
    },
  ]);
  // 2) Xcode 프로젝트 리소스로 추가(Copy Bundle Resources)
  config = withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const srcDir = path.join(cfg.modRequest.projectRoot, IOS_SRC);
    for (const f of listFiles(srcDir, '.caf')) {
      const filepath = `${projName}/${f}`;
      if (typeof project.hasFile === 'function' && project.hasFile(filepath)) continue;
      IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath,
        groupName: projName,
        project,
        isBuildFile: true,
        verbose: false,
      });
    }
    return cfg;
  });
  return config;
}

module.exports = function withPresetAlarmSounds(config) {
  config = withAndroidRawSounds(config);
  config = withIosBundleSounds(config);
  return config;
};
