import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/api_client.dart';
import 'package:music_room/core/realtime_service.dart';
import 'package:music_room/core/server_settings.dart';

const session = {
  'accessToken': 'access',
  'refreshToken': 'refresh',
  'deviceId': 'd1',
};

void main() {
  test('a refused handshake refreshes once per session', () async {
    FlutterSecureStorage.setMockInitialValues({});
    final store = SessionStore();
    await store.save(session);
    final server = ServerSettings();
    await server.save(
      'http://127.0.0.1:1',
    ); // nothing listens: no real handshake
    var refreshes = 0;
    final api = ApiClient(
      httpClient: MockClient((_) async {
        refreshes++;
        return http.Response(jsonEncode(session), 200);
      }),
      baseUrl: 'http://api.test',
      store: store,
    );
    final realtime = RealtimeService(api: api, server: server, store: store);
    addTearDown(realtime.disconnect);
    const refused = {'message': 'unauthorized'};

    realtime.connect();
    await realtime.handleConnectError(refused);
    await realtime.handleConnectError(refused);
    expect(refreshes, 1);

    realtime.disconnect();
    realtime.connect();
    await realtime.handleConnectError(refused);
    expect(refreshes, 2);
  });
}
