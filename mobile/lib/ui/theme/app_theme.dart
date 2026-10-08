import 'package:flutter/material.dart';

class AppPalette {
  static const darkBg = Color(0xFF0E0E12);
  static const lightBg = Color(0xFFFAFAFC);

  static const darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: Color(0xFF9D7BFF),
    onPrimary: Color(0xFF0E0E12),
    secondary: Color(0xFF9D7BFF),
    onSecondary: Color(0xFF0E0E12),
    error: Color(0xFFFF5C7A),
    onError: Color(0xFF0E0E12),
    surface: Color(0xFF17171D),
    onSurface: Color(0xFFF4F4F6),
    onSurfaceVariant: Color(0xFFA1A1AE),
    surfaceContainerHigh: Color(0xFF202028),
    outline: Color(0xFF2C2C36),
  );

  static const lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: Color(0xFF6A45F5),
    onPrimary: Color(0xFFFFFFFF),
    secondary: Color(0xFF6A45F5),
    onSecondary: Color(0xFFFFFFFF),
    error: Color(0xFFD12C4C),
    onError: Color(0xFFFFFFFF),
    surface: Color(0xFFFFFFFF),
    onSurface: Color(0xFF14141A),
    onSurfaceVariant: Color(0xFF5D5D6B),
    surfaceContainerHigh: Color(0xFFF1F1F5),
    outline: Color(0xFFE4E4EA),
  );
}

@immutable
class StatusColors extends ThemeExtension<StatusColors> {
  const StatusColors({required this.success, required this.warning});
  final Color success;
  final Color warning;

  static const dark = StatusColors(
    success: Color(0xFF3DDC97),
    warning: Color(0xFFFFB547),
  );
  static const light = StatusColors(
    success: Color(0xFF0B7A54),
    warning: Color(0xFFA15C00),
  );

  @override
  StatusColors copyWith({Color? success, Color? warning}) => StatusColors(
    success: success ?? this.success,
    warning: warning ?? this.warning,
  );

  @override
  StatusColors lerp(StatusColors? other, double t) => other == null
      ? this
      : StatusColors(
          success: Color.lerp(success, other.success, t)!,
          warning: Color.lerp(warning, other.warning, t)!,
        );
}

const _textTheme = TextTheme(
  displaySmall: TextStyle(
    fontFamily: 'SpaceGrotesk',
    fontSize: 32,
    height: 38 / 32,
    fontWeight: FontWeight.w700,
  ),
  titleLarge: TextStyle(
    fontFamily: 'SpaceGrotesk',
    fontSize: 24,
    height: 30 / 24,
    fontWeight: FontWeight.w600,
  ),
  titleMedium: TextStyle(
    fontFamily: 'Inter',
    fontSize: 18,
    height: 24 / 18,
    fontWeight: FontWeight.w600,
  ),
  bodyLarge: TextStyle(
    fontFamily: 'Inter',
    fontSize: 16,
    height: 22 / 16,
    fontWeight: FontWeight.w400,
  ),
  labelLarge: TextStyle(
    fontFamily: 'Inter',
    fontSize: 14,
    height: 20 / 14,
    fontWeight: FontWeight.w500,
  ),
  bodySmall: TextStyle(
    fontFamily: 'Inter',
    fontSize: 12,
    height: 16 / 12,
    fontWeight: FontWeight.w500,
  ),
);

ThemeData buildAppTheme(Brightness brightness) {
  final isDark = brightness == Brightness.dark;
  final scheme = isDark ? AppPalette.darkScheme : AppPalette.lightScheme;
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: isDark ? AppPalette.darkBg : AppPalette.lightBg,
    textTheme: _textTheme.apply(
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
    ),
    extensions: [isDark ? StatusColors.dark : StatusColors.light],
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
    ),
    cardTheme: CardThemeData(
      color: scheme.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}
