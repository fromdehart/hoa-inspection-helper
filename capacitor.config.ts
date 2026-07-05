import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.happierblock.app",
  appName: "Happier Block",
  webDir: "dist",
  // Serve the bundled app from https://localhost on BOTH platforms. The iOS
  // default (capacitor://) is a custom scheme where cookies don't persist, which
  // breaks cookie-based auth (Clerk). https://localhost is a proper secure
  // context, so the session sticks. Keeps CORS/allowed-origins consistent too.
  server: {
    androidScheme: "https",
    iosScheme: "https",
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
