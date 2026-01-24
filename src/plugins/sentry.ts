import type { App } from 'vue';
import * as Sentry from '@sentry/vue';

export type SentryFeedbackClient = ReturnType<typeof Sentry.getFeedback>;

let feedbackPromise: Promise<SentryFeedbackClient | null> | null = null;

export function getSentryFeedback(app?: App) {
  if (feedbackPromise) return feedbackPromise;

  feedbackPromise = (async () => {
    try {
      const feedbackIntegration = Sentry.feedbackIntegration({
        autoInject: false,
        colorScheme: 'dark',
        formTitle: 'Send your feedback',
        submitButtonLabel: 'Send feedback',
        showBranding: false,
        enableScreenshot: false,
        isNameRequired: false,
        isEmailRequired: false,
        messagePlaceholder: "Suggested new feature, a bug that's bugging you, or a nit-pick.",
        successMessageText: 'Thanks for your feedback!',
      });

      Sentry.init({
        app,
        dsn: 'https://3dce88b3fb7f2f63c1d57be6206686e3@o4510765351436288.ingest.de.sentry.io/4510765361332304',
        environment: import.meta.env.MODE,
        defaultIntegrations: false,
        integrations: [feedbackIntegration],
        tracesSampleRate: 0,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        beforeSend() {
          return null;
        },
        beforeBreadcrumb() {
          return null;
        },
      });

      return Sentry.getFeedback();
    } catch (error) {
      console.warn('Sentry initialization skipped', error);
      return null;
    }
  })();

  return feedbackPromise;
}
