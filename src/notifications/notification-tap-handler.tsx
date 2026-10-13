import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useAuthStore } from '@/store/auth';
import { remindersSupported, resolveReminderRoute } from './reminders';

/**
 * Sends a tapped reminder to the screen it is about.
 *
 * Renders nothing. It is mounted only once the root navigator exists and the user is signed
 * in, because Expo Router requires the navigator to be mounted before any navigation and
 * the protected screens do not exist before sign-in. Meeting that condition by where this
 * component is rendered is deliberately simpler than tracking a readiness flag in state.
 */
export function NotificationTapHandler() {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  useEffect(() => {
    if (!remindersSupported()) return;

    // Guards against handling one response twice: a cold-start response is read from the
    // getter below and can also be replayed by the listener.
    const handled = new Set<string>();

    async function handleTap(response: Notifications.NotificationResponse) {
      // A plain tap only. Anything else is a declared action with its own identifier.
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

      const key = `${response.notification.request.identifier}:${response.notification.date}`;
      if (handled.has(key)) return;
      handled.add(key);

      // Claimed once, so restarting the app cannot navigate from a stale tap.
      Notifications.clearLastNotificationResponse();

      const route = await resolveReminderRoute(response.notification.request.content.data, userId);
      if (route) router.push(route as Href);
    }

    // A tap that launched the app never reaches the listener; only the getter sees it.
    const initialResponse = Notifications.getLastNotificationResponse();
    if (initialResponse) void handleTap(initialResponse);

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleTap(response);
    });

    return () => subscription.remove();
  }, [userId]);

  return null;
}
