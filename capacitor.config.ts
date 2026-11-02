import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.pigeonpost',
  appName: 'Pigeon Post',
  webDir: 'dist',
  // https://localhost origin: the API's CORS list and Cognito callbacks are configured for it (plan G2).
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 0, backgroundColor: '#fff8f4' },
    Keyboard: { resize: 'body' },
  },
}

export default config
