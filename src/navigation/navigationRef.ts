import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef<any>();

export function navigateTo(name: string, params?: Record<string, any>): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name as never, params as never);
  }
}
