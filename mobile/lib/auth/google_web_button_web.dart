import 'package:flutter/widgets.dart';
import 'package:google_sign_in_web/web_only.dart' as gsi;

/// Google draws this button in an iframe: colors and font cannot follow our theme
/// (and its branding rules forbid it). What can match: light or dark, shape, full width.
Widget googleWebButton({required bool dark, required double width}) {
  return gsi.renderButton(
    configuration: gsi.GSIButtonConfiguration(
      theme: dark ? gsi.GSIButtonTheme.filledBlack : gsi.GSIButtonTheme.outline,
      size: gsi.GSIButtonSize.large,
      text: gsi.GSIButtonText.continueWith,
      shape: gsi.GSIButtonShape.rectangular,
      logoAlignment: gsi.GSIButtonLogoAlignment.center,
      // Google caps the width at 400 px
      minimumWidth: width.clamp(200, 400),
    ),
  );
}
