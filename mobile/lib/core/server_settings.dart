import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:music_room/core/config.dart';

/// The API address, editable in the app (subject V.5: "the back-end's address must be
/// configurable on the application for tests"). The build-time value is the default.
class ServerSettings {
  ServerSettings([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  static const _key = 'api_base_url';

  String _baseUrl = AppConfig.apiBaseUrl;
  String get baseUrl => _baseUrl;

  /// Called once at startup, before the first request.
  Future<void> load() async {
    _baseUrl = await _storage.read(key: _key) ?? AppConfig.apiBaseUrl;
  }

  /// Saves an address already checked with [validate].
  Future<void> save(String input) async {
    final url = normalize(input);
    await _storage.write(key: _key, value: url);
    _baseUrl = url;
  }

  Future<void> reset() async {
    await _storage.delete(key: _key);
    _baseUrl = AppConfig.apiBaseUrl;
  }

  /// Error message for the form, or null when the address can be used.
  static String? validate(String input) {
    final uri = Uri.tryParse(input.trim());
    if (uri == null ||
        !(uri.isScheme('http') || uri.isScheme('https')) ||
        uri.host.isEmpty) {
      return 'Enter an address like http://192.168.1.10:3000';
    }
    if (uri.hasQuery ||
        uri.hasFragment ||
        (uri.path.isNotEmpty && uri.path != '/')) {
      return 'Only scheme, host and port: no path';
    }
    return null;
  }

  static String normalize(String input) =>
      input.trim().replaceFirst(RegExp(r'/+$'), '');
}
