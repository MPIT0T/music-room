import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/core/config.dart';
import 'package:music_room/core/server_settings.dart';

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  test('accepts scheme, host and port only', () {
    for (final ok in [
      'http://192.168.1.10:3000',
      'https://music.example.com',
      'http://localhost:3000/',
    ]) {
      expect(ServerSettings.validate(ok), isNull, reason: ok);
    }
    for (final bad in [
      '',
      'localhost:3000',
      'ftp://host',
      'http://',
      'http://host/api',
      'http://h?x=1',
    ]) {
      expect(ServerSettings.validate(bad), isNotNull, reason: bad);
    }
  });

  test('a saved address survives a restart, and reset goes back to the build default', () async {
    await ServerSettings().save(' http://10.0.0.5:3000/ ');

    final restarted = ServerSettings();
    await restarted.load();
    expect(restarted.baseUrl, 'http://10.0.0.5:3000');

    await restarted.reset();
    final again = ServerSettings();
    await again.load();
    expect(again.baseUrl, AppConfig.apiBaseUrl);
  });
}
