import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:music_room/auth/auth_service.dart';
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/api_client.dart';

const idToken = 'google.id.token';

Map<String, Object?> session(String deviceId) => {
  'accessToken': 'access-$deviceId',
  'accessTokenExpiresIn': 900,
  'refreshToken': 'refresh-$deviceId',
  'refreshTokenExpiresIn': 2592000,
  'deviceId': deviceId,
  'user': {'id': 'u1'},
};

http.Response problem(int status, String code) => http.Response(
  jsonEncode({'type': '/problems/$code', 'status': status, 'code': code}),
  status,
  headers: {'content-type': 'application/problem+json'},
);

void main() {
  late List<http.Request> requests;
  late SessionStore store;

  AuthService serviceAnswering(http.Response Function(http.Request) answer) {
    final client = MockClient((request) async {
      requests.add(request);
      return answer(request);
    });
    return AuthService(
      api: ApiClient(httpClient: client, baseUrl: 'http://api.test'),
      store: store,
    );
  }

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    store = SessionStore();
    requests = [];
  });

  test(
    'first sign-in posts the ID token and device, stores the session: created',
    () async {
      final service = serviceAnswering(
        (_) => http.Response(jsonEncode(session('d1')), 201),
      );

      final result = await service.signInWithGoogle(idToken);

      expect(result, SignInResult.created);
      expect(
        requests.single.url.toString(),
        'http://api.test/v1/sessions/oauth',
      );
      expect(jsonDecode(requests.single.body), {
        'provider': 'google',
        'idToken': idToken,
        'device': {'name': 'Android phone', 'platform': 'android'},
      });
      expect(await store.accessToken(), 'access-d1');
      expect(await store.refreshToken(), 'refresh-d1');
      expect(await store.deviceId(), 'd1');
    },
  );

  test('next sign-in sends the stored deviceId: existing', () async {
    await store.save(session('d1'));
    final service = serviceAnswering(
      (_) => http.Response(jsonEncode(session('d1')), 200),
    );

    final result = await service.signInWithGoogle(idToken);

    expect(result, SignInResult.existing);
    expect(jsonDecode(requests.single.body)['deviceId'], 'd1');
  });

  test('each API error becomes a user message, nothing is stored', () async {
    const cases = {
      401: 'invalid_oauth_token',
      403: 'oauth_email_not_verified',
      409: 'already_linked',
      503: 'oauth_unavailable',
    };
    for (final MapEntry(key: status, value: code) in cases.entries) {
      final service = serviceAnswering((_) => problem(status, code));

      final failure = await service
          .signInWithGoogle(idToken)
          .then<AuthFailure?>(
            (_) => null,
            onError: (Object e) => e as AuthFailure,
          );

      expect(failure?.code, code);
      expect(failure?.message, isNot(contains('_')));
      // The ID token must never reach a message or a log line
      expect(failure.toString(), isNot(contains(idToken)));
      expect(await store.accessToken(), isNull);
    }
  });

  test('an unknown error code still gives a readable message', () async {
    final service = serviceAnswering(
      (_) => http.Response('<html>bad gateway</html>', 502),
    );

    final failure = await service
        .signInWithGoogle(idToken)
        .then<AuthFailure?>(
          (_) => null,
          onError: (Object e) => e as AuthFailure,
        );

    expect(failure?.code, 'http_502');
    expect(failure?.message, 'Sign-in failed. Please try again.');
  });

  test('a network failure gives network_error', () async {
    final service = serviceAnswering(
      (_) => throw http.ClientException('connection refused'),
    );

    final failure = await service
        .signInWithGoogle(idToken)
        .then<AuthFailure?>(
          (_) => null,
          onError: (Object e) => e as AuthFailure,
        );

    expect(failure?.code, 'network_error');
  });

  test('clearTokens keeps the deviceId for the next login', () async {
    await store.save(session('d1'));

    await store.clearTokens();

    expect(await store.accessToken(), isNull);
    expect(await store.refreshToken(), isNull);
    expect(await store.deviceId(), 'd1');
  });
}
