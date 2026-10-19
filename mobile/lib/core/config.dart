/// Build-time settings, passed by `make mobile` with --dart-define (see Makefile).
/// Only public values: a client ID is shipped inside the app anyway.
abstract final class AppConfig {
  /// localhost on every platform: `make mobile` runs `adb reverse tcp:3000 tcp:3000`,
  /// which forwards the phone's (or emulator's) port 3000 to this machine.
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );

  /// "Web application" OAuth client: clientId on web, serverClientId on Android,
  /// so the ID token audience is always this client (what the API checks).
  static const googleWebClientId = String.fromEnvironment(
    'GOOGLE_CLIENT_ID_WEB',
  );
}
