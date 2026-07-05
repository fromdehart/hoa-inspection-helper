import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.happierblock.app",
  appName: "Happier Block",
  webDir: "dist",
  // Android serves the bundled app from https://localhost (matches iOS's secure
  // context, keeps CORS/allowed-origin handling consistent across platforms).
  server: {
    androidScheme: "https",
  },
  ios: {
    contentInset: "always",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: "#1e1b4b",
      showSpinner: false,
    },
    Camera: {
      // We request only what the inspector flow needs.
    },
  },
};

export default config;
