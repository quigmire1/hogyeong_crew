import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "hogyeong_crew",
  slug: "hogyeong_crew",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "hogyeongcrew",
  userInterfaceStyle: "automatic",

  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.quigmire1.hogyeongcrew",
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    },
    infoPlist: {
      CFBundleURLTypes: [
        {
          CFBundleURLSchemes: ["hogyeongcrew"]
        }
      ]
    }
  },
  android: {
    package: "com.quigmire1.hogyeongcrew",
    intentFilters: [
      {
        action: "VIEW",
        data: {
          scheme: "hogyeongcrew",
          host: "auth",
          path: "/callback",
        },
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png"
    },

    predictiveBackGestureEnabled: false,
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "",
      }
    }
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png"
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000"
        }
      }
    ],
    [
      "expo-location",
      {
        "locationAlwaysAndWhenInUsePermission": "백그라운드에서 산행 기록을 저장하고 분석하기 위해 항상 위치 권한이 필요합니다.",
        "locationAlwaysPermission": "산행 중 앱이 백그라운드에 있을 때도 경로를 기록하기 위해 위치 권한이 필요합니다.",
        "locationWhenInUsePermission": "산행 경로를 지도에 표시하기 위해 위치 권한이 필요합니다.",
        "isIosBackgroundLocationEnabled": true,
        "isAndroidBackgroundLocationEnabled": true
      }
    ],
    [
      "expo-image-picker",
      {
        "photosPermission": "등산 중 촬영한 사진을 지도에 표시하기 위해 갤러리 권한이 필요합니다.",
        "cameraPermission": "등산 중 풍경을 촬영하여 지도에 표시하기 위해 카메라 권한이 필요합니다."
      }
    ]
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true
  }
});
