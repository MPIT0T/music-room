import 'package:music_room/core/services.dart';
import 'package:music_room/ui/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:music_room/app/router.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // The API address chosen in the app must be known before the first request
  await serverSettings.load();
  apiClient.onSessionExpired = () => AppRouterConfig.router.go('/welcome');
  runApp(
    MaterialApp.router(
      routerConfig: AppRouterConfig.router,
      theme: buildAppTheme(Brightness.light),
      darkTheme: buildAppTheme(Brightness.dark),
      themeMode: ThemeMode.system,
    ),
  );
}
