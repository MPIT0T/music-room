import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/api_client.dart';
import 'package:music_room/core/queue_service.dart';

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

const item = {
  'id': 'i1',
  'track': {
    'id': 't1',
    'title': 'Song',
    'artist': 'Band',
    'durationMs': null,
    'coverUrl': null,
  },
  'addedBy': null,
  'votes': 3,
  'myVote': true,
  'createdAt': '2026-11-22T10:00:00.000Z',
};

void main() {
  late List<http.Request> requests;

  setUp(() {
    requests = [];
    // In-memory secure storage: the test needs no token, the mock ignores headers
    FlutterSecureStorage.setMockInitialValues({});
  });

  QueueService serviceAnswering(http.Response Function(http.Request) answer) {
    final client = MockClient((request) async {
      requests.add(request);
      return answer(request);
    });
    return QueueService(
      api: ApiClient(
        httpClient: client,
        baseUrl: 'http://api.test',
        store: SessionStore(),
      ),
    );
  }

  test('queue parses the queue and a null playing track', () async {
    final service = serviceAnswering(
      (_) => json(200, {
        'playing': null,
        'queue': [item],
      }),
    );

    final queue = await service.queue('r1');

    expect(requests.single.method, 'GET');
    expect(requests.single.url.path, '/v1/rooms/r1/tracks');
    expect(queue.playing, isNull);
    expect(queue.queue.single.id, 'i1');
    expect(queue.queue.single.votes, 3);
    expect(queue.queue.single.myVote, isTrue);
    expect(queue.queue.single.track.durationMs, isNull);
  });

  test('queue parses the playing track', () async {
    final service = serviceAnswering(
      (_) => json(200, {'playing': item, 'queue': <Object>[]}),
    );

    final queue = await service.queue('r1');

    expect(queue.playing?.track.title, 'Song');
    expect(queue.queue, isEmpty);
  });

  test('vote sends a PUT on the item vote', () async {
    final service = serviceAnswering((_) => http.Response('', 204));

    await service.vote('r1', 'i1');

    expect(requests.single.method, 'PUT');
    expect(requests.single.url.path, '/v1/rooms/r1/tracks/i1/vote');
  });

  test('unvote sends a DELETE on the item vote', () async {
    final service = serviceAnswering((_) => http.Response('', 204));

    await service.unvote('r1', 'i1');

    expect(requests.single.method, 'DELETE');
    expect(requests.single.url.path, '/v1/rooms/r1/tracks/i1/vote');
  });

  test('a refused vote becomes a QueueFailure with a message', () async {
    final service = serviceAnswering((_) => problem(403, 'not_invited'));

    await expectLater(
      service.vote('r1', 'i1'),
      throwsA(
        isA<QueueFailure>()
            .having((f) => f.code, 'code', 'not_invited')
            .having((f) => f.message, 'message', contains('invited')),
      ),
    );
  });

  test('an unknown code gets the generic message', () async {
    final service = serviceAnswering((_) => problem(500, 'boom'));

    await expectLater(
      service.queue('r1'),
      throwsA(
        isA<QueueFailure>()
            .having((f) => f.code, 'code', 'boom')
            .having((f) => f.message, 'message', contains('try again')),
      ),
    );
  });
}
