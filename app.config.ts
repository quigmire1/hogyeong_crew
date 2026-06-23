import { ExpoConfig, ConfigContext } from 'expo/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withHogyeongKakaoMap = require('./plugins/withHogyeongKakaoMap');

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";
const kakaoNativeAppKey = process.env.EXPO_PUBLIC_KAKAO_NATIVE_APP_KEY || "";

const plugins: NonNullable<ExpoConfig["plugins"]> = [
  "expo-router",
  [
    "expo-build-properties",
    {
      android: {
        extraMavenRepos: [
          "https://devrepo.kakao.com/nexus/content/groups/public/"
        ]
      }
    }
  ],
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
      "locationAlwaysAndWhenInUsePermission": "백그라운드에서 덩산 기록을 저장하고 분석하기 위해 항상 위치 권한이 필요합니다.",
      "locationAlwaysPermission": "덩산 중 앱이 백그라운드에 있을 때도 경로를 기록하기 위해 위치 권한이 필요합니다.",
      "locationWhenInUsePermission": "덩산 경로를 지도에 표시하기 위해 위치 권한이 필요합니다.",
      "isIosBackgroundLocationEnabled": true,
      "isAndroidBackgroundLocationEnabled": true
    }
  ],
  [
    "expo-image-picker",
    {
      "photosPermission": "덩산 중 촬영한 사진을 지도에 표시하기 위해 갤러리 권한이 필요합니다.",
      "cameraPermission": "덩산 중 풍경을 촬영하여 지도에 표시하기 위해 카메라 권한이 필요합니다."
    }
  ],
  "expo-notifications",
  withHogyeongKakaoMap as any
];

if (kakaoNativeAppKey) {
  plugins.push([
    "@react-native-kakao/core",
    {
      nativeAppKey: kakaoNativeAppKey,
      ios: {}
    }
  ]);
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "덩산",
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
      googleMapsApiKey,
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
        },
        category: ["BROWSABLE", "DEFAULT"],
      },
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
        apiKey: googleMapsApiKey,
      }
    }
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png"
  },
  plugins,
  experiments: {
    typedRoutes: true,
    reactCompiler: true
  }
});
