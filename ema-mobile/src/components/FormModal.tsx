import { ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from './PrimaryButton';
import { palette } from '../theme/colors';

type FormModalProps = {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Disable on Android to avoid height jumps when the modal opens. */
  avoidKeyboard?: boolean;
};

export function FormModal({
  visible,
  title,
  onClose,
  children,
  footer,
  avoidKeyboard = true,
}: FormModalProps) {
  const insets = useSafeAreaInsets();
  const useKav = avoidKeyboard && Platform.OS === 'ios';

  return (
    <Modal visible={visible} transparent animationType='slide' onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={useKav ? 'padding' : undefined}
        enabled={useKav}
        keyboardVerticalOffset={useKav ? insets.top + 8 : 0}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        />
        <View pointerEvents='box-none' style={[styles.center, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
          <ScrollView
            keyboardShouldPersistTaps='handled'
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
          >
            <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
              <Text style={styles.title}>{title}</Text>
              {children}
              {footer ?? <PrimaryButton label='Close' onPress={onClose} style={{ marginTop: 12 }} />}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  scroll: { width: '100%', maxHeight: '100%' },
  scrollContent: { flexGrow: 1, justifyContent: 'center' },
  card: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
  },
  title: {
    color: palette.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 12,
  },
});
