import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/api_client.dart';
import 'package:music_room/data/models/friend.dart';
import 'package:music_room/friends/friends_service.dart';

http.Response json(int status, Object body) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

http.Response problem(int status, String code) => http.Response(
  jsonEncode({'type': '/problems/$code', 'status': status, 'code': code}),
  status,
  headers: {'content-type': 'application/problem+json'},
);

const max = {'userId': 'u1', 'displayName': 'Max', 'avatarUrl': null};

void main() {
  late List<http.Request> requests;

  setUp(() {
    requests = [];
    // In-memory secure storage: the test needs no token, the mock ignores headers
    FlutterSecureStorage.setMockInitialValues({});
  });

  FriendsService serviceAnswering(http.Response Function(http.Request) answer) {
    final client = MockClient((request) async {
      requests.add(request);
      return answer(request);
    });
    return FriendsService(
      api: ApiClient(
        httpClient: client,
        baseUrl: 'http://api.test',
        store: SessionStore(),
      ),
    );
  }

  test('list parses the friends', () async {
    final service = serviceAnswering(
      (_) => json(200, {
        'friends': [max],
      }),
    );

    final friends = await service.list();

    expect(requests.single.method, 'GET');
    expect(requests.single.url.path, '/v1/friends');
    expect(friends.single.displayName, 'Max');
  });

  test('requests splits incoming and outgoing', () async {
    final service = serviceAnswering(
      (_) => json(200, {
        'incoming': [
          {...max, 'createdAt': '2026-11-02T17:30:00.000Z'},
        ],
        'outgoing': <Object>[],
      }),
    );

    final r = await service.requests();

    expect(r.incoming.single.user.userId, 'u1');
    expect(r.outgoing, isEmpty);
  });

  test('search encodes the query', () async {
    final service = serviceAnswering(
      (_) => json(200, {
        'users': [
          {...max, 'friendship': 'incoming'},
        ],
      }),
    );

    final users = await service.search('a b&c');

    expect(requests.single.url.path, '/v1/users/search');
    expect(requests.single.url.queryParameters['q'], 'a b&c');
    expect(users.single.friendship, Friendship.incoming);
  });

  test('add sends a PUT without body and reports acceptance', () async {
    final service = serviceAnswering((_) => json(200, {'status': 'accepted'}));

    expect(await service.add('u1'), isTrue);
    expect(requests.single.method, 'PUT');
    expect(requests.single.url.path, '/v1/friends/u1');
    expect(requests.single.body, isEmpty);
  });

  test('add returns false while the request is pending', () async {
    final service = serviceAnswering((_) => json(200, {'status': 'pending'}));

    expect(await service.add('u1'), isFalse);
  });

  test('remove sends a DELETE', () async {
    final service = serviceAnswering((_) => http.Response('', 204));

    await service.remove('u1');

    expect(requests.single.method, 'DELETE');
    expect(requests.single.url.path, '/v1/friends/u1');
  });

  test('an API error becomes a FriendsFailure with a message', () async {
    final service = serviceAnswering((_) => problem(429, 'rate_limited'));

    await expectLater(
      service.add('u1'),
      throwsA(
        isA<FriendsFailure>()
            .having((f) => f.code, 'code', 'rate_limited')
            .having((f) => f.message, 'message', contains('wait')),
      ),
    );
  });
}
