import React, { useCallback, useState } from 'react';
import { StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import {
  Screen,
  ScreenHeader,
  Card,
  Row,
  NavRow,
  Disclosure,
  Text,
  Button,
  Field,
  PrimaryNav,
} from '@/components/ui';
import { spacing } from '@/design/tokens';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import {
  authErrorMessage,
  deleteUserAccount,
  requestPasswordReset,
  updateUserPassword,
} from '@/lib/auth';
import {
  getConsent,
  getSetup,
  listEntries,
  syncUnsyncedEntries,
  clearLocalUserData,
  type ConsentRecord,
  type ExperimentSetupRecord,
} from '@/data/experiment-store';
import { clearDailyReminder } from '@/notifications/reminders';

export default function SettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);

  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [setup, setSetup] = useState<ExperimentSetupRecord | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  const [newPassword, setNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [clearingLocal, setClearingLocal] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    if (!user) return;
    try {
      const [loadedConsent, loadedSetup, loadedEntries] = await Promise.all([
        getConsent(user.id),
        getSetup(user.id),
        listEntries(user.id),
      ]);
      setConsent(loadedConsent);
      setSetup(loadedSetup);
      setUnsyncedCount(loadedEntries.filter((e) => e.synced === false).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load settings.');
    }
  }, [user]);

  // The focus effect also runs on mount (the screen is focused when it mounts), so a
  // separate mount effect would only fetch the same data twice.
  useFocusEffect(
    useCallback(() => {
      void loadSettings();
    }, [loadSettings]),
  );

  const handleUpdatePassword = async () => {
    if (!supabase || updatingPassword) return;
    setUpdatingPassword(true);
    setError(null);
    setNotice(null);
    try {
      await updateUserPassword(supabase.auth, newPassword);
      setNewPassword('');
      setNotice('Your password has been updated.');
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!supabase || !user?.email || sendingReset) return;
    setSendingReset(true);
    setError(null);
    setNotice(null);
    try {
      await requestPasswordReset(supabase.auth, user.email);
      setNotice(`Password reset link sent to ${user.email}.`);
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSendingReset(false);
    }
  };

  const handleRetrySync = async () => {
    if (!user || syncing) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await syncUnsyncedEntries(user.id);
      await loadSettings();
      if (res.failedCount === 0) {
        setNotice('All entries are synced with your account.');
      } else {
        setError(`${res.failedCount} entr${res.failedCount === 1 ? 'y' : 'ies'} still waiting to sync.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleClearLocalCache = async () => {
    if (!user || clearingLocal) return;
    const message =
      'This clears the entries stored on this device. Anything already synced to your account stays.';
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(message)
        : await new Promise<boolean>((resolve) => {
            Alert.alert('Clear this device?', message, [
              { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
              { text: 'Clear', onPress: () => resolve(true), style: 'destructive' },
            ]);
          });
    if (!confirmed) return;

    setClearingLocal(true);
    setError(null);
    setNotice(null);
    try {
      await clearLocalUserData(user.id);
      await loadSettings();
      setNotice('Cleared on this device.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear this device.');
    } finally {
      setClearingLocal(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || deletingAccount) return;
    const message =
      'This deletes your account and every sleep and caffeine entry you have logged. It cannot be undone.';
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(message)
        : await new Promise<boolean>((resolve) => {
            Alert.alert('Delete your account?', message, [
              { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
              { text: 'Delete Account', onPress: () => resolve(true), style: 'destructive' },
            ]);
          });
    if (!confirmed) return;

    setDeletingAccount(true);
    setError(null);
    setNotice(null);
    try {
      if (!supabase) {
        throw new Error('Server connection is required to delete your account.');
      }
      await deleteUserAccount(supabase);
      await clearDailyReminder();
      await clearLocalUserData(user.id);
      await signOut();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Screen>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          overline="PREFERENCES & ACCOUNT"
          title="Settings"
          notice="This app is not medical advice."
        />

        {error ? (
          <Card tone="danger">
            <Text color="garnet" accessibilityRole="alert">{error}</Text>
          </Card>
        ) : null}

        {notice ? (
          <Card>
            <Text variant="sub" color="champagneLight" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          </Card>
        ) : null}

        {/* 1. Reminders */}
        <Card overline="REMINDERS">
          <Row label="Your caffeine cutoff" value={setup?.cutoffTime ?? 'Not set'} />
          <Row
            label="Sync"
            value={unsyncedCount === 0 ? 'All synced' : `${unsyncedCount} waiting`}
            emphasis={unsyncedCount === 0 ? 'strong' : 'danger'}
          />

          <NavRow
            label="Reminders"
            detail="When your morning nudge arrives"
            onPress={() => router.push('/reminder-settings' as Href)}
          />
          <NavRow
            label="Your setup & consent"
            detail="Your cutoff time and what you agreed to"
            onPress={() => router.push('/setup-consent' as Href)}
          />
          {unsyncedCount > 0 ? (
            <Button
              label="Try sync again"
              variant="primary"
              loading={syncing}
              onPress={() => void handleRetrySync()}
            />
          ) : null}
        </Card>

        {/* 2. Account */}
        <Card overline="ACCOUNT">
          <Row label="Signed in as" value={user?.email ?? 'Unknown'} />

          <Disclosure label="Change password" summary="Set a new password">
            <Field
              label="New password (at least 8 characters)"
              accessibilityLabel="New password"
              placeholder="Enter new password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={!updatingPassword}
            />
            <Button
              label="Update password"
              variant="secondary"
              loading={updatingPassword}
              disabled={!supabase || newPassword.length === 0}
              onPress={() => void handleUpdatePassword()}
            />
          </Disclosure>

          {user?.email ? (
            <NavRow
              label="Send password reset email"
              detail={user.email}
              disabled={!supabase || sendingReset}
              onPress={() => void handleSendResetEmail()}
            />
          ) : null}
          <NavRow label="Sign out" onPress={() => void handleSignOut()} />
        </Card>

        {/* 3. Privacy & Data */}
        <Card overline="YOUR DATA">
          <Row
            label="Consent"
            value={consent?.granted ? 'Agreed' : 'Not agreed'}
            emphasis={consent?.granted ? 'strong' : 'danger'}
          />
          <Disclosure label="How your data is stored" summary="What we keep and where">
            <Text variant="caption" color="ivorySecondary">
              • Your sleep and caffeine times are used only to run your own sleep test.
            </Text>
            <Text variant="caption" color="ivorySecondary">
              • Entries are cached on your device for offline reliability and synced to your private account.
            </Text>
            <Text variant="caption" color="ivorySecondary">
              • Reminder preferences stay on this device and can be turned off at any time.
            </Text>
            <Text variant="caption" color="champagne">
              This app is not medical advice.
            </Text>
          </Disclosure>
        </Card>

        {/* 4. Help */}
        <Card overline="HELP">
          <Disclosure label="Questions people ask" summary="Dates, missing fields and locked days">
            <Text variant="sub" color="champagneLight" weight="semiBold">
              Why does my check-in use yesterday’s date?
            </Text>
            <Text variant="caption" color="ivorySecondary">
              Yesterday’s caffeine goes with the sleep you just woke up from. Logging this morning answers for last night.
            </Text>

            <Text variant="sub" color="champagneLight" weight="semiBold">
              What if I skip a field or forget a day?
            </Text>
            <Text variant="caption" color="ivorySecondary">
              A blank field stays blank. It never becomes zero sleep or no caffeine, and you can edit yesterday and the 3 days before it.
            </Text>

            <Text variant="sub" color="champagneLight" weight="semiBold">
              Why can’t I change some days?
            </Text>
            <Text variant="caption" color="ivorySecondary">
              Days lock once you have saved what we found for a test. That keeps the saved reading matched to your log.
            </Text>
          </Disclosure>
        </Card>

        {/* 5. Delete */}
        <Card tone="danger" overline="DELETE">
          <Text variant="caption" color="ivoryMuted">
            Clear what is stored on this device, or delete your account and all your records for good.
          </Text>
          <Button
            label="Clear this device"
            variant="secondary"
            loading={clearingLocal}
            onPress={() => void handleClearLocalCache()}
          />
          <Button
            label="Delete my account and data"
            variant="quiet"
            loading={deletingAccount}
            onPress={() => void handleDeleteAccount()}
          />
        </Card>
      </ScrollView>

      <PrimaryNav current="settings" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { gap: spacing.section, paddingBottom: spacing.section },
});
