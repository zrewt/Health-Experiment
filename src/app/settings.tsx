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
      'This clears cached entries and plan state stored on this device. Synced data on your account remains intact.';
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(message)
        : await new Promise<boolean>((resolve) => {
            Alert.alert('Clear Device Cache?', message, [
              { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
              { text: 'Clear Cache', onPress: () => resolve(true), style: 'destructive' },
            ]);
          });
    if (!confirmed) return;

    setClearingLocal(true);
    setError(null);
    setNotice(null);
    try {
      await clearLocalUserData(user.id);
      await loadSettings();
      setNotice('Local device cache cleared.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear local cache.');
    } finally {
      setClearingLocal(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || deletingAccount) return;
    const message =
      'This permanently deletes your account and all logged sleep, caffeine, and experiment records. This action cannot be undone.';
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(message)
        : await new Promise<boolean>((resolve) => {
            Alert.alert('Delete Account Permanently?', message, [
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

        {/* 1. Reminders & Experiment Setup */}
        <Card overline="REMINDERS & EXPERIMENT SETUP">
          <Row label="Personal caffeine cutoff" value={setup?.cutoffTime ?? 'Not configured'} />
          <Row
            label="Sync status"
            value={unsyncedCount === 0 ? 'All entries synced' : `${unsyncedCount} waiting to sync`}
            emphasis={unsyncedCount === 0 ? 'strong' : 'danger'}
          />

          <NavRow
            label="Reminder settings"
            detail="When the morning check-in nudge arrives"
            onPress={() => router.push('/reminder-settings' as Href)}
          />
          <NavRow
            label="Review setup & consent"
            detail="Cutoff time and what you agreed to"
            onPress={() => router.push('/setup-consent' as Href)}
          />
          {unsyncedCount > 0 ? (
            <Button
              label="Retry syncing entries"
              variant="primary"
              loading={syncing}
              onPress={() => void handleRetrySync()}
            />
          ) : null}
        </Card>

        {/* 2. Account & Security */}
        <Card overline="ACCOUNT & SECURITY">
          <Row label="Signed in as" value={user?.email ?? 'Unknown'} />

          <Disclosure label="Change password" summary="Set a new password for this account">
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
        <Card overline="PRIVACY & DATA">
          <Row
            label="Consent status"
            value={consent?.granted ? `Granted (${consent.policyVersion})` : 'Not currently granted'}
            emphasis={consent?.granted ? 'strong' : 'danger'}
          />
          <Disclosure label="How your data is stored" summary="What is logged and where it lives">
            <Text variant="caption" color="ivorySecondary">
              • Your sleep duration and caffeine cutoff logs are used only to run your personal n-of-1 self-experiment.
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

        {/* 4. Help & Everyday Use */}
        <Card overline="HELP & EVERYDAY USE">
          <Disclosure label="Frequently asked questions" summary="Dates, missing fields and locked days">
            <Text variant="sub" color="champagneLight" weight="semiBold">
              Why does my morning check-in log yesterday’s date?
            </Text>
            <Text variant="caption" color="ivorySecondary">
              Each exposure day pairs yesterday’s caffeine intake with the sleep you just woke up from this morning.
            </Text>

            <Text variant="sub" color="champagneLight" weight="semiBold">
              What if I skip a field or forget a day?
            </Text>
            <Text variant="caption" color="ivorySecondary">
              Missing is never turned into zero sleep or no caffeine. Unlogged fields remain unknown, and you can backfill or edit yesterday and the previous 3 days.
            </Text>

            <Text variant="sub" color="champagneLight" weight="semiBold">
              Why are completed experiment days locked?
            </Text>
            <Text variant="caption" color="ivorySecondary">
              Once you view your experiment result, the scheduled days in that experiment are locked so your saved result always matches the underlying log.
            </Text>
          </Disclosure>
        </Card>

        {/* 5. Account & Data Deletion */}
        <Card tone="danger" overline="DATA & ACCOUNT DELETION">
          <Text variant="caption" color="ivoryMuted">
            Clear cached data on this device or permanently delete your account and all stored experiment records.
          </Text>
          <Button
            label="Clear device cache"
            variant="secondary"
            loading={clearingLocal}
            onPress={() => void handleClearLocalCache()}
          />
          <Button
            label="Delete account & all data"
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
  content: { gap: spacing.md, paddingBottom: spacing.lg },
});
