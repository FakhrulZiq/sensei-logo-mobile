import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'my.sensei.logo.app',
  appName: 'SenSei Catalog',
  webDir: 'dist',
  plugins: {
    FirebaseAuthentication: {
      providers: ['google.com'],
      skipNativeAuth: false,
    },
    // Native requests avoid WebView CORS restrictions; this also handles logo FormData.
    CapacitorHttp: { enabled: true },
  },
};

export default config;
