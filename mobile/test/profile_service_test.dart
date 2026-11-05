import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/api_client.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/profile/profile_service.dart';

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

// Shape of GET /v1/me
const meJson = {
  'id': 'u1',
  'emailVerified': true,
  'plan': 'free',
  'providers': ['password'],
  'public': {
    'displayName': 'Max',
    'avatarUrl': null,
    'bio': 'Jazz at night',
    'genres': [
      {'id': 5, 'name': 'Jazz'},
    ],
  },
  'friends': {'city': 'Lyon', 'phone': null},
  'private': {
    'realName': null,
    'birthDate': '2000-01-31',
    'email': 'max@musicroom.test',
  },
};

void main() {
  late List<http.Request> requests;

  setUp(() {
    requests = [];
    // In-memory secure storage: the test needs no token, the mock ignores headers
    FlutterSecureStorage.setMockInitialValues({});
  });

  ProfileService serviceAnswering(http.Response Function(http.Request) answer) {
    final client = MockClient((request) async {
      requests.add(request);
      return answer(request);
    });
    return ProfileService(
      api: ApiClient(
        httpClient: client,
        baseUrl: 'http://api.test',
        store: SessionStore(),
      ),
    );
  }

  test('me parses the three visibility groups', () async {
    final service = serviceAnswering((_) => json(200, meJson));

    final me = await service.me();

    expect(requests.single.method, 'GET');
    expect(requests.single.url.path, '/v1/me');
    expect(me.plan, Plan.free);
    expect(me.hasPassword, isTrue);
    expect(me.hasGoogle, isFalse);
    expect(me.displayName, 'Max');
    expect(me.genres.single.name, 'Jazz');
    expect(me.city, 'Lyon');
    expect(me.phone, isNull);
    expect(me.birthDate, '2000-01-31');
  });

  test('setPlan sends the plan name', () async {
    final service = serviceAnswering((_) => http.Response('', 204));

    await service.setPlan(Plan.premium);

    expect(requests.single.method, 'PUT');
    expect(requests.single.url.path, '/v1/me/subscription');
    expect(jsonDecode(requests.single.body), {'plan': 'premium'});
  });

  test('update sends the whole form and returns the saved account', () async {
    final service = serviceAnswering((_) => json(200, meJson));

    final me = await service.update(
      displayName: 'Max',
      bio: 'Jazz at night',
      city: 'Lyon',
      phone: '',
      realName: '',
      birthDate: null,
      genreIds: [5],
    );

    expect(requests.single.method, 'PATCH');
    expect(requests.single.url.path, '/v1/me');
    expect(jsonDecode(requests.single.body), {
      'displayName': 'Max',
      'bio': 'Jazz at night',
      'city': 'Lyon',
      'phone': '',
      'realName': '',
      'birthDate': null,
      'genreIds': [5],
    });
    expect(me.city, 'Lyon');
  });

  test('genres lists the genres of the API', () async {
    final service = serviceAnswering(
      (_) => json(200, {
        'genres': [
          {'id': 5, 'name': 'Jazz'},
          {'id': 2, 'name': 'Rock'},
        ],
      }),
    );

    final genres = await service.genres();

    expect(requests.single.url.path, '/v1/genres');
    expect(genres.map((g) => g.name), ['Jazz', 'Rock']);
  });

  test('errors become a ProfileFailure with a readable message', () async {
    final service = serviceAnswering((_) => problem(429, 'rate_limited'));

    await expectLater(
      service.setPlan(Plan.premium),
      throwsA(
        isA<ProfileFailure>()
            .having((e) => e.code, 'code', 'rate_limited')
            .having((e) => e.message, 'message', isNot(contains('_'))),
      ),
    );
  });
}
