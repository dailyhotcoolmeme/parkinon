import { isOverseasLocale } from '../i18n/detectLocale';

// 브랜드 로고: 국내(한국어) = 한글 로고, 해외 = 영어 로고.
// require는 정적으로 해석되므로 양쪽을 미리 참조해두고 런타임 로케일로 선택한다.
const KO_LOGO = require('../../assets/parkinon-logo.png');
const EN_LOGO = require('../../assets/parkinon-logo-en.png');

export function getBrandLogo() {
  return isOverseasLocale() ? EN_LOGO : KO_LOGO;
}
