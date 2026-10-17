import React, { useCallback, useState } from 'react';
import { StyleSheet, ScrollView, Alert, Platform, Share, View } from 'react-native';
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
  Banner,
} from '@/components/ui';
import { spacing } from '@/design/tokens';
import { sentenceCase } from '@/design/labels';
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
  getActivePlan,
  listExperimentPlans,
  syncUnsyncedEntries,
  clearLocalUserData,
  type ConsentRecord,
  type ExperimentSetupRecord,
  type StoredDailyEntry,
} from '@/data/experiment-store';
import type { StoredExperimentPlan } from '@/data/plan-persistence';
import { buildEntriesCsv, buildUserDataJson } from '@/data/data-export';
import { clearDailyReminder } from '@/notifications/reminders';
import { experimentById, experimentForRuleType } from '@/experiment/experiments';

function triggerWebDownload(filename: string, content: string, mimeType: string): boolean {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof Blob === 'undefined') {
    return false;
  }
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

export default function SettingsScreen() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);
  const forgetSession = useAuthStore((state) => state.forgetSession);

  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [setup, setSetup] = useState<ExperimentSetupRecord | null>(null);
  const [entries, setEntries] = useState<StoredDailyEntry[]>([]);
  const [plans, setPlans] = useState<StoredExperimentPlan[]>([]);
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  const [newPassword, setNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [clearingLocal, setClearingLocal] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    if (!user) return;
    try {
      const [loadedConsent, loadedSetup, loadedEntries, loadedActive, loadedHistory] =
        await Promise.all([
          getConsent(user.id),
          getSetup(user.id),
          listEntries(user.id),
          getActivePlan(user.id).catch(() => null),
          listExperimentPlans(user.id).catch(() => []),
        ]);
      setConsent(loadedConsent);
      setSetup(loadedSetup);
      setEntries(loadedEntries);
      const seen = new Set<string>();
      const allPlans: StoredExperimentPlan[] = [];
      for (const p of [loadedActive, ...loadedHistory]) {
        if (p && !seen.has(p.id)) {
          seen.add(p.id);
          allPlans.push(p);
        }
      }
      setPlans(allPlans);
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

  // The active test names its own rows and data bullets. A plan owns the test while one
  // exists; otherwise the setup row does, which is what the setup empty state writes.
  const activePlan =
    plans.find((item) => item.status !== 'completed' && item.status !== 'cancelled') ?? null;
  const experiment = activePlan
    ? experimentForRuleType(activePlan.plan.definition.conditionRule.type)
    : experimentById(setup?.experimentId);
  // "screen use" rather than "screens", so the sentences below read naturally.
  const exposureNote = experiment.id === 'screens-off-cutoff' ? 'screen use' : 'caffeine';

  const handleExportData = async (format: 'json' | 'csv') => {
    if (!user || exporting) return;
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const dateStamp = new Date().toISOString().slice(0, 10);
      const filename =
        format === 'json' ? `aevum-log-${dateStamp}.json` : `aevum-log-${dateStamp}.csv`;
      const content =
        format === 'json'
          ? buildUserDataJson({
              exportedAt: new Date().toISOString(),
              accountEmail: user.email ?? null,
              setup,
              consent,
              entries,
              plans,
            })
          : buildEntriesCsv(entries);

      if (triggerWebDownload(filename, content, format === 'json' ? 'application/json' : 'text/csv')) {
        setNotice(`Downloaded ${filename} (${entries.length} logged day${entries.length === 1 ? '' : 's'}).`);
      } else {
        await Share.share({
          title: filename,
          message: content,
        });
        setNotice(`Prepared ${filename} (${entries.length} logged day${entries.length === 1 ? '' : 's'}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export your log.');
    } finally {
      setExporting(false);
    }
  };

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
    // Names the one real risk before asking: entries that never reached the account live
    // only here, and clearing takes them with it. Everything else comes back from the server.
    const unsyncedWarning =
      unsyncedCount > 0
        ? ` ${unsyncedCount} entr${unsyncedCount === 1 ? 'y has' : 'ies have'} not reached your account yet, and clearing loses ${unsyncedCount === 1 ? 'it' : 'them'}.`
        : '';
    const message =
      `This clears the entries stored on this device. Anything already synced to your account stays.${unsyncedWarning}`;
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
      const report = await clearLocalUserData(user.id);
      await loadSettings();
      const count = report.removedKeys.length;
      setNotice(
        count === 0
          ? 'Nothing was stored on this device to clear. Your log is in your account.'
          : `Cleared ${count} stored item${count === 1 ? '' : 's'} from this device. Your account copy was not deleted, so your log is shown again from the server copy.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not clear this device.');
    } finally {
      setClearingLocal(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user || deletingAccount) return;
    const message =
      'This deletes your account and every sleep, caffeine and screen entry you have logged. It cannot be undone.';
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
    const userId = user.id;
    try {
      if (!supabase) {
        throw new Error('Server connection is required to delete your account.');
      }
      // The rows can only be deleted server-side, so that call comes first: if it fails,
      // nothing on this device has changed and the error is worth showing.
      await deleteUserAccount(supabase);
    } catch (cause) {
      setError(authErrorMessage(cause));
      setDeletingAccount(false);
      return;
    }

    // From here the account is gone. Device cleanup and sign-out are best-effort on
    // purpose: neither may leave the user sitting in a signed-in app for an account that
    // no longer exists, and a failed cache removal is not a failed deletion.
    await clearDailyReminder();
    try {
      await clearLocalUserData(userId);
    } catch {
      // Offline cache only; the account and every row in it are already deleted.
    }
    try {
      await signOut();
    } catch {
      // The stored token is dead now, so drop the in-memory session and leave anyway.
      forgetSession();
    }
    setDeletingAccount(false);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    try {
      // Clear scheduled OS notifications on sign-out so a signed-out device is not
      // nudged with active-experiment reminders.
      await clearDailyReminder();
      await signOut();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          overline={sentenceCase('PREFERENCES & ACCOUNT')}
          title="Settings"
          notice="This app is not medical advice."
        />

        {error ? (
          <Banner
            tone="error"
            action={
              unsyncedCount > 0 ? (
                <Button
                  label="Try sync again"
                  variant="quiet"
                  loading={syncing}
                  onPress={() => void handleRetrySync()}
                />
              ) : (
                <Button
                  label="Export backup"
                  variant="quiet"
                  onPress={() => void handleExportData('json')}
                />
              )
            }
          >
            {error}
          </Banner>
        ) : null}

        {notice ? <Banner tone="success">{notice}</Banner> : null}

        {/* 1. Reminders */}
        <Card overline={sentenceCase('REMINDERS')}>
          <Row label={`Your ${experiment.exposureWord} cutoff`} value={setup?.cutoffTime ?? 'Not set'} />
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
        <Card overline={sentenceCase('ACCOUNT')}>
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

        {/* 3. Privacy & Data (with one-tap export) */}
        <Card tone="tint" overline={sentenceCase('YOUR DATA')}>
          <Row
            label="Consent"
            value={consent?.granted ? 'Agreed' : 'Not agreed'}
            emphasis={consent?.granted ? 'strong' : 'danger'}
          />
          <Row label="Days in your log" value={String(entries.length)} />

          <View style={styles.exportRow}>
            <Button
              label="Export JSON"
              variant="secondary"
              loading={exporting}
              onPress={() => void handleExportData('json')}
              style={styles.flexBtn}
            />
            <Button
              label="Export CSV"
              variant="secondary"
              loading={exporting}
              onPress={() => void handleExportData('csv')}
              style={styles.flexBtn}
            />
          </View>

          <Disclosure label="How your data is stored" summary="What we keep and where">
            <Text variant="caption" color="textMuted">
              • {`Your sleep and ${exposureNote} times are used only to run your own sleep test.`}
            </Text>
            <Text variant="caption" color="textMuted">
              • Entries are cached on your device for offline reliability and synced to your private account.
            </Text>
            <Text variant="caption" color="textMuted">
              • Reminder preferences stay on this device and can be turned off at any time.
            </Text>
            <Text variant="caption" color="accent">
              This app is not medical advice.
            </Text>
          </Disclosure>
        </Card>

        {/* 4. Help */}
        <Card overline={sentenceCase('HELP')}>
          <Disclosure label="Questions people ask" summary="Dates, missing fields and locked days">
            <Text variant="sub" color="accent" weight="semiBold">
              Why does my check-in use yesterday’s date?
            </Text>
            <Text variant="caption" color="textMuted">
              Yesterday’s {exposureNote} goes with the sleep you just woke up from. Logging this morning answers for last night.
            </Text>

            <Text variant="sub" color="accent" weight="semiBold">
              What if I skip a field or forget a day?
            </Text>
            <Text variant="caption" color="textMuted">
              A blank field stays blank. It never becomes zero sleep or {exposureNote === 'caffeine' ? 'no caffeine' : 'no screens'}, and you can edit yesterday and the 3 days before it.
            </Text>

            <Text variant="sub" color="accent" weight="semiBold">
              Why can’t I change some days?
            </Text>
            <Text variant="caption" color="textMuted">
              Days lock once you have saved what we found for a test. That keeps the saved reading matched to your log.
            </Text>
          </Disclosure>
        </Card>

        {/* 5. Delete */}
        <Card tone="danger" overline={sentenceCase('DELETE')}>
          <Text variant="caption" color="textMuted">
            Export a copy of your log above before deleting if you want to keep it. Clearing this device removes only local cache; deleting your account removes all records for good.
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
  exportRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexBtn: {
    flex: 1,
  },
});
