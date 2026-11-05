import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/profile/profile_service.dart';
import 'package:music_room/ui/screens/profile/profile_screen.dart';

class FakeProfileService extends Fake implements ProfileService {
  ProfileFailure? failure;

  @override
  Future<Me> me() async {
    if (failure != null) throw failure!;
    return const Me(
      id: 'u1',
      plan: Plan.premium,
      providers: ['password'],
      displayName: 'Max',
      bio: 'Jazz at night',
      genres: [
        Genre(id: 5, name: 'Jazz'),
        Genre(id: 2, name: 'Rock'),
      ],
    );
  }
}

void main() {
  late FakeProfileService service;

  setUp(() => service = FakeProfileService());

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(home: ProfileScreen(service: service)));
    await tester.pumpAndSettle(); // waits for GET /v1/me
  }

  testWidgets('shows the account from the API', (tester) async {
    await open(tester);

    expect(find.text('Max'), findsOneWidget);
    expect(find.text('Premium'), findsOneWidget);
    expect(find.text('Jazz at night'), findsOneWidget);
    expect(find.text('Jazz'), findsOneWidget);
    expect(find.text('Rock'), findsOneWidget);
  });

  testWidgets('an error offers to retry', (tester) async {
    service.failure = const ProfileFailure('network_error', 'Offline.');
    await open(tester);

    expect(find.text('Offline.'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
  });
}
