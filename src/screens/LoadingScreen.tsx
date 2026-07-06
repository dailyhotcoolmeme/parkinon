import React from 'react';
import i18n from '../i18n';
import { FullscreenBoot } from '../components/common/FullscreenBoot';

export function LoadingScreen() {
  return <FullscreenBoot message={i18n.t('loading.appPreparing')} />;
}
