import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.lucky.kira',
  appName: 'Kira',
  webDir: 'src/www',
  server: {
    androidScheme: 'https',
  },
};

export default config;
