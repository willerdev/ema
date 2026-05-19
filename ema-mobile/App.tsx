import 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AppLockProvider } from './src/context/AppLockContext';
import { ToastProvider } from './src/context/ToastContext';
import { ToastHost } from './src/components/ToastHost';
import { AppLockOverlay } from './src/components/AppLockOverlay';
import { RootNavigator } from './src/navigation/RootNavigator';
import { palette } from './src/theme/colors';

function AppShell() {
  const { user } = useAuth();

  return (
    <AppLockProvider isAuthenticated={Boolean(user)}>
      <ToastProvider>
        <NavigationContainer
          theme={{
            dark: true,
            colors: {
              primary: palette.primary,
              background: palette.background,
              card: palette.surface,
              text: palette.textPrimary,
              border: palette.border,
              notification: palette.primary,
            },
            fonts: {
              regular: { fontFamily: 'System', fontWeight: '400' },
              medium: { fontFamily: 'System', fontWeight: '500' },
              bold: { fontFamily: 'System', fontWeight: '700' },
              heavy: { fontFamily: 'System', fontWeight: '800' },
            },
          }}
        >
          <StatusBar style='light' />
          <RootNavigator />
          {user ? <AppLockOverlay /> : null}
          <ToastHost />
        </NavigationContainer>
      </ToastProvider>
    </AppLockProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
