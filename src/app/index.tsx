import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Screen, Text, Button } from '@/components/ui';
import { useAuthStore } from '@/store/auth';
import { authErrorMessage } from '@/lib/auth';

export default function HomeScreen() {
  const signOut = useAuthStore((state) => state.signOut);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignOut = async () => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await signOut();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="titleSmall">Home</Text>
        <Button label="Sign out" variant="quiet" loading={loading} onPress={() => void handleSignOut()} />
      </View>
      {error ? <Text color="garnet" accessibilityRole="alert">{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
