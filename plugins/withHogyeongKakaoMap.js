const {
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
  withXcodeProject,
} = require('@expo/config-plugins');
const { createBuildSourceFile } = require('@expo/config-plugins/build/ios/XcodeProjectFile');
const { getProjectName } = require('@expo/config-plugins/build/ios/utils/Xcodeproj');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');

const KAKAO_MAP_DEPENDENCY = 'implementation("com.kakao.maps.open:android:2.10.3")';
const PACKAGE_NAME = 'com.quigmire1.hogyeongcrew';
const PACKAGE_PATH = PACKAGE_NAME.replace(/\./g, '/');
const ANDROID_TEMPLATE_DIR = path.join(__dirname, 'hogyeong-kakao-map', 'android');
const IOS_TEMPLATE_DIR = path.join(__dirname, 'hogyeong-kakao-map', 'ios');

const withHogyeongKakaoMap = (config) => {
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes(KAKAO_MAP_DEPENDENCY)) {
      mod.modResults.contents = mod.modResults.contents.replace(
        'implementation("com.facebook.react:react-android")',
        `implementation("com.facebook.react:react-android")\n    ${KAKAO_MAP_DEPENDENCY}`,
      );
    }

    return mod;
  });

  config = withMainApplication(config, (mod) => {
    if (!mod.modResults.contents.includes('HogyeongKakaoMapPackage')) {
      mod.modResults.contents = mod.modResults.contents.replace(
        'import com.facebook.react.defaults.DefaultReactNativeHost',
        `import com.facebook.react.defaults.DefaultReactNativeHost\nimport ${PACKAGE_NAME}.map.HogyeongKakaoMapPackage`,
      );
      mod.modResults.contents = mod.modResults.contents.replace(
        '// add(MyReactNativePackage())',
        '// add(MyReactNativePackage())\n              add(HogyeongKakaoMapPackage())',
      );
    }

    return mod;
  });

  config = withDangerousMod(config, [
    'android',
    async (mod) => {
      const targetDir = path.join(
        mod.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        PACKAGE_PATH,
        'map',
      );
      await fs.mkdir(targetDir, { recursive: true });

      await Promise.all(
        [
          'HogyeongKakaoMapPackage.kt',
          'HogyeongKakaoMapView.kt',
          'HogyeongKakaoMapViewManager.kt',
        ].map(async (filename) => {
          await fs.copyFile(
            path.join(ANDROID_TEMPLATE_DIR, filename),
            path.join(targetDir, filename),
          );
        }),
      );

      return mod;
    },
  ]);

  config = withXcodeProject(config, (mod) => {
    const projectName = getProjectName(mod.modRequest.projectRoot);
    const targetDir = path.join(
      mod.modRequest.platformProjectRoot,
      projectName,
      'HogyeongKakaoMap',
    );
    fsSync.mkdirSync(targetDir, { recursive: true });

    for (const filename of [
      'HogyeongKakaoMapView.swift',
      'HogyeongKakaoMapViewManager.m',
    ]) {
      const contents = fsSync.readFileSync(
        path.join(IOS_TEMPLATE_DIR, filename),
        'utf8',
      );
      mod.modResults = createBuildSourceFile({
        project: mod.modResults,
        nativeProjectRoot: mod.modRequest.platformProjectRoot,
        filePath: path.join(projectName, 'HogyeongKakaoMap', filename),
        fileContents: contents,
        overwrite: true,
      });
    }

    return mod;
  });

  return config;
};

module.exports = withHogyeongKakaoMap;
