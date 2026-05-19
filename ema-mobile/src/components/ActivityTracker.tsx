import { ReactNode } from 'react';
import { View } from 'react-native';
import { useAppLock } from '../context/AppLockContext';

export function ActivityTracker({ children }: { children: ReactNode }) {
  const { recordActivity } = useAppLock();

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponder={() => {
        recordActivity();
        return false;
      }}
      onMoveShouldSetResponder={() => {
        recordActivity();
        return false;
      }}
    >
      {children}
    </View>
  );
}
