import 'package:music_room/ui/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:music_room/app/router.dart';

void main() => runApp(
  MaterialApp.router(
    routerConfig: AppRouterConfig.router,
    theme: buildAppTheme(Brightness.light),
    darkTheme: buildAppTheme(Brightness.dark),
    themeMode: ThemeMode.system,
  ),
);
