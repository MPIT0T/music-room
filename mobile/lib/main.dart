import 'package:music_room/ui/theme/app_theme.dart';
import 'package:flutter/material.dart';

void main() => runApp(
  MaterialApp(
    theme: buildAppTheme(Brightness.light),
    darkTheme: buildAppTheme(Brightness.dark),
    home: Scaffold(body: Text("Bonjour")),
  ),
);
