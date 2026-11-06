import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/profile/profile_service.dart';
import 'package:music_room/ui/screens/profile/edit_profile_screen.dart';

// Fake service: answers from memory and records the saved form
class FakeProfileService extends Fake implements ProfileService {
  Map<String, Object?>? saved;
  ProfileFailure? failure;

  @override
  Future<Me> me() async => const Me(
    id: 'u1',
    plan: Plan.free,
    providers: ['password'],
    displayName: 'Max',
    bio: 'Jazz at night',
    city: 'Lyon',
    birthDate: '2000-01-31',
    email: 'max@musicroom.test',
    genres: [Genre(id: 5, name: 'Jazz')],
  );

  @override
  Future<List<Genre>> genres() async => const [
    Genre(id: 5, name: 'Jazz'),
    Genre(id: 2, name: 'Rock'),
  ];

  @override
  Future<Me> update({
    required String displayName,
    required String bio,
    required String city,
    required String phone,
    required String realName,
    required String? birthDate,
    required List<int> genreIds,
  }) async {
    if (failure != null) throw failure!;
    saved = {
      'displayName': displayName,
      'bio': bio,
      'city': city,
      'phone': phone,
      'realName': realName,
      'birthDate': birthDate,
      'genreIds': genreIds,
    };
    return me();
  }
}

void main() {
  late FakeProfileService service;

  setUp(() => service = FakeProfileService());

  // Opened from a first page, like the profile in the app: saving goes back to it
  Future<void> open(WidgetTester tester) async {
    // Tall enough for the whole form: a ListView only builds what is on screen
    tester.view.physicalSize = const Size(800, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => EditProfileScreen(service: service),
                ),
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle(); // waits for GET /v1/me and /v1/genres
  }

  Finder field(String label) => find.descendant(
    of: find
        .ancestor(of: find.text(label), matching: find.byType(Column))
        .first,
    matching: find.byType(TextFormField),
  );

  Future<void> save(WidgetTester tester) async {
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();
  }

  testWidgets('the form is filled from the account', (tester) async {
    await open(tester);

    expect(find.text('Public'), findsOneWidget);
    expect(find.text('Friends'), findsOneWidget);
    expect(find.text('Private'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Max'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Lyon'), findsOneWidget);
    expect(find.text('2000-01-31'), findsOneWidget);
    expect(find.text('max@musicroom.test'), findsOneWidget);
    expect(
      tester
          .widget<FilterChip>(find.widgetWithText(FilterChip, 'Jazz'))
          .selected,
      isTrue,
    );
  });

  testWidgets('saving sends the edited fields and genres', (tester) async {
    await open(tester);

    await tester.enterText(field('City'), 'Paris');
    await tester.tap(find.widgetWithText(FilterChip, 'Rock'));
    await tester.tap(find.widgetWithText(FilterChip, 'Jazz'));
    await tester.tap(find.byTooltip('Clear birth date'));
    await tester.pump();
    await save(tester);

    expect(service.saved, {
      'displayName': 'Max',
      'bio': 'Jazz at night',
      'city': 'Paris',
      'phone': '',
      'realName': '',
      'birthDate': null,
      'genreIds': [2],
    });
    expect(find.text('Profile saved.'), findsOneWidget);
    expect(find.byType(EditProfileScreen), findsNothing); // back to the profile
  });

  testWidgets('invalid fields show their error and nothing is sent', (
    tester,
  ) async {
    await open(tester);

    await tester.enterText(field('Display name'), '   ');
    await tester.enterText(field('Phone'), 'call me');
    await save(tester);

    expect(find.text('Enter a display name'), findsOneWidget);
    expect(find.text('Digits, spaces and + ( ) . - only'), findsOneWidget);
    expect(service.saved, isNull);
  });

  testWidgets('a refused save keeps the form open with the message', (
    tester,
  ) async {
    service.failure = const ProfileFailure('unknown_genre', 'Genre gone.');
    await open(tester);

    await save(tester);

    expect(find.text('Genre gone.'), findsOneWidget);
    expect(find.byType(EditProfileScreen), findsOneWidget);
  });
}
