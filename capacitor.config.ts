import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.cfofitness',
  appName: 'CFO Fitness',
  webDir: 'public',
  server: {
    // cfofitness.app (Porkbun/Cloudflare DNS → Firebase App Hosting)
    // This URL is baked into the binary — do not change without a new App Store release.
    url: 'https://cfofitness.app',
    cleartext: false,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'always',
    // NOTE: app-bound domains is intentionally OFF. It would lock WebView
    // navigation to a fixed domain list and break the in-WebView OAuth
    // redirects (Fitbit/Oura/Withings/Google Health navigate to external
    // domains). Revisit if/when auth moves to a native plugin or
    // ASWebAuthenticationSession.
    limitsNavigationsToAppBoundDomains: false,
    scrollEnabled: false,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0a0a0a',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      spinnerColor: '#6366f1',
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#0a0a0a',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Camera: {
      // Reuse the existing food-photo flow in the hosted app.
      resultType: 'base64',
      quality: 80,
    },
  },
};

export default config;
