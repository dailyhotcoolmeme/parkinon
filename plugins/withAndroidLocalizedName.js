// Android 앱 표시명(런처 아이콘 라벨)을 영어 로케일에서만 "ParkinON"으로 로컬라이즈.
// 기본(한국어)은 app.json expo.name("파킨온") = values/strings.xml 의 app_name 그대로 유지.
// expo.locales 는 iOS(CFBundleDisplayName)만 처리하므로, Android 는 이 config plugin 으로
//   res/values-en/strings.xml 에 app_name 을 덮어써서 영어 기기에서 ParkinON 이 뜨게 한다.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withAndroidLocalizedName(config, props = {}) {
  const enName = props.en || 'ParkinON';
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const resDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'values-en');
      fs.mkdirSync(resDir, { recursive: true });
      const xml =
        '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<resources>\n' +
        `  <string name="app_name">${enName}</string>\n` +
        '</resources>\n';
      fs.writeFileSync(path.join(resDir, 'strings.xml'), xml, 'utf8');
      return cfg;
    },
  ]);
};
