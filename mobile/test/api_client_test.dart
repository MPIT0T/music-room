import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/api_client.dart';

const userAgent = 'MusicRoom/1.0.0 (android; Pixel 7)';

Map<String, Object?> session(String n) => {
  'accessToken': 'access-$n',
  'refreshToken': 'refresh-$n',
  'deviceId': 'd1',
};

http.Response json(int status, Object body) =>
    http.Response(jsonEncode(body), status);
http.Response problem(int status, String code) => json(status, {'code': code});

void main() {
  late SessionStore store;
  late List<http.Request> requests;
  late int expired;

  ApiClient client(FutureOr<http.Response> Function(http.Request) answer) {
    final api = ApiClient(
      httpClient: MockClient((request) async {
        requests.add(request);
        return answer(request);
      }),
      baseUrl: 'http://api.test',
      store: store,
      userAgent: () async => userAgent,
    );
    api.onSessionExpired = () => expired++;
    return api;
  }

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    store = SessionStore();
    await store.save(session('1'));
    requests = [];
    expired = 0;
  });

  test('every request carries the User-Agent the API logs; auth ones the access token', () async {
    final api = client((_) => json(200, {}));

    await api.get('/v1/me');
    await api.postJson('/v1/sessions', {'email': 'a@b.c'});

    expect(
      requests.map((r) => r.headers['user-agent']),
      everyElement(userAgent),
    );
    expect(requests[0].headers['authorization'], 'Bearer access-1');
    expect(requests[1].headers.containsKey('authorization'), isFalse);
  });

  test(
    'two requests expiring together share one refresh, then both are replayed',
    () async {
      final refreshed = Completer<void>();
      final api = client((request) async {
        if (request.url.path == '/v1/sessions/refresh') {
          await refreshed
              .future; // both requests are waiting on the same refresh by now
          return json(200, session('2'));
        }
        final token = request.headers['authorization'];
        return token == 'Bearer access-2'
            ? json(200, {'ok': true})
            : problem(401, 'unauthorized');
      });

      final calls = Future.wait([api.get('/v1/me'), api.get('/v1/me/devices')]);
      await Future<void>.delayed(Duration.zero);
      refreshed.complete();
      final results = await calls;

      expect(results.map((r) => r.status), [200, 200]);
      final refreshes = requests
          .where((r) => r.url.path == '/v1/sessions/refresh')
          .toList();
      expect(refreshes, hasLength(1));
      expect(jsonDecode(refreshes.single.body), {'refreshToken': 'refresh-1'});
      expect(await store.accessToken(), 'access-2');
      expect(await store.refreshToken(), 'refresh-2');
    },
  );

  test('a dead refresh token signs the user out and forgets the tokens, keeps the deviceId', () async {
    final api = client(
      (request) => request.url.path == '/v1/sessions/refresh'
          ? problem(401, 'refresh_token_reused')
          : problem(401, 'unauthorized'),
    );

    await expectLater(
      api.get('/v1/me'),
      throwsA(
        isA<ApiException>().having((e) => e.code, 'code', 'unauthorized'),
      ),
    );

    expect(expired, 1);
    expect(await store.accessToken(), isNull);
    expect(await store.refreshToken(), isNull);
    expect(await store.deviceId(), 'd1');
  });

  test(
    'a wrong password (401 invalid_credentials) never triggers a refresh',
    () async {
      final api = client((_) => problem(401, 'invalid_credentials'));

      await expectLater(
        api.putJson('/v1/me/password', {}),
        throwsA(isA<ApiException>()),
      );

      expect(
        requests.where((r) => r.url.path == '/v1/sessions/refresh'),
        isEmpty,
      );
      expect(expired, 0);
    },
  );

  test('offline during refresh: the session is kept, the call fails', () async {
    final api = client((request) {
      if (request.url.path == '/v1/sessions/refresh') {
        throw http.ClientException('connection refused');
      }
      return problem(401, 'unauthorized');
    });

    await expectLater(api.get('/v1/me'), throwsA(isA<ApiException>()));

    expect(expired, 0);
    expect(await store.refreshToken(), 'refresh-1');
  });

  test(
    'any transport failure becomes network_error, never an uncaught exception',
    () async {
      // e.g. a TLS handshake error: not an http.ClientException
      final api = client(
        (_) => throw const FormatException('handshake failed'),
      );

      await expectLater(
        api.get('/v1/me'),
        throwsA(
          isA<ApiException>().having((e) => e.code, 'code', 'network_error'),
        ),
      );
    },
  );
}
