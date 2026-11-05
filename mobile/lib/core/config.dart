import 'package:flutter/foundation.dart';

/// Build-time settings, passed by `make mobile` with --dart-define (see Makefile).
/// Only public values: a client ID is shipped inside the app anyway.
abstract final class AppConfig {
  static const _apiBaseUrlOverride = String.fromEnvironment('API_BASE_URL');

  /// Default API address, before any change in the app's server setting.
  /// Android: localhost, since `make mobile` runs `adb reverse tcp:3000 tcp:3000`,
  /// which forwards the phone's (or emulator's) port 3000 to this machine.
  /// Web: the computer that served the page, so the same build works on localhost
  /// and from another school computer, whatever the machine running the stack.
  static String get apiBaseUrl {
    if (_apiBaseUrlOverride.isNotEmpty) return _apiBaseUrlOverride;
    return kIsWeb ? apiUrlForPage(Uri.base) : 'http://localhost:3000';
  }

  /// "Web application" OAuth client: clientId on web, serverClientId on Android,
  /// so the ID token audience is always this client (what the API checks).
  static const googleWebClientId = String.fromEnvironment(
    'GOOGLE_CLIENT_ID_WEB',
  );
}

/// The API listens on port 3000 of the computer that served the web app.
@visibleForTesting
String apiUrlForPage(Uri page) =>
    Uri(scheme: page.scheme, host: page.host, port: 3000).toString();
