import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/auth/auth_service.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/profile/profile_service.dart';
import 'package:music_room/ui/screens/profile/settings_screen.dart';

// Fake services: answer from memory and record the actions
class FakeProfileService extends Fake implements ProfileService {
  var plan = Plan.free;
  var providers = ['password'];
  final actions = <String>[];
  ProfileFailure? failure;

  @override
  Future<Me> me() async => Me(
    id: 'u1',
    plan: plan,
    providers: providers,
    displayName: 'Max',
    genres: const [],
  );

  @override
  Future<void> setPlan(Plan plan) async {
    if (failure != null) throw failure!;
    actions.add('plan ${plan.name}');
    this.plan = plan;
  }
}

class FakeAuthService extends Fake implements AuthService {
  final actions = <String>[];

  @override
  Future<void> changePassword(
    String currentPassword,
    String newPassword,
  ) async {
    actions.add('password $currentPassword -> $newPassword');
  }
}

void main() {
  late FakeProfileService profile;
  late FakeAuthService auth;

  setUp(() {
    profile = FakeProfileService();
    auth = FakeAuthService();
  });

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: SettingsScreen(profile: profile, auth: auth),
      ),
    );
    await tester.pumpAndSettle(); // waits for _load
  }

  bool selected(WidgetTester tester, Plan plan) => tester
      .widget<SegmentedButton<Plan>>(find.byType(SegmentedButton<Plan>))
      .selected
      .contains(plan);

  testWidgets('switching to premium saves the plan', (tester) async {
    await open(tester);
    expect(selected(tester, Plan.free), isTrue);

    await tester.tap(find.text('Premium'));
    await tester.pumpAndSettle();

    expect(profile.actions, ['plan premium']);
    expect(selected(tester, Plan.premium), isTrue);
    expect(find.text('You are now premium.'), findsOneWidget);
  });

  testWidgets('a refused plan change shows the error', (tester) async {
    profile.failure = const ProfileFailure('rate_limited', 'Slow down.');
    await open(tester);

    await tester.tap(find.text('Premium'));
    await tester.pumpAndSettle();

    expect(find.text('Slow down.'), findsOneWidget);
    expect(selected(tester, Plan.free), isTrue); // nothing changed
  });

  testWidgets('a new password shorter than 8 is refused before the API', (
    tester,
  ) async {
    await open(tester);

    await tester.tap(find.text('Change password'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).at(0), 'old password');
    await tester.enterText(find.byType(TextFormField).at(1), 'short');
    await tester.tap(find.widgetWithText(FilledButton, 'Change'));
    await tester.pumpAndSettle();

    expect(find.text('8 to 128 characters'), findsOneWidget);
    expect(auth.actions, isEmpty);
  });

  testWidgets('changing the password sends both passwords', (tester) async {
    await open(tester);

    await tester.tap(find.text('Change password'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextFormField).at(0), 'old password');
    await tester.enterText(find.byType(TextFormField).at(1), 'new password');
    await tester.tap(find.widgetWithText(FilledButton, 'Change'));
    await tester.pumpAndSettle();

    expect(auth.actions, ['password old password -> new password']);
    expect(
      find.text('Password changed. Your other devices are signed out.'),
      findsOneWidget,
    );
  });

  testWidgets('a Google-only account has no password to change', (
    tester,
  ) async {
    profile.providers = ['google'];
    await open(tester);

    expect(find.text('Change password'), findsNothing);
    expect(find.text('Unlink Google'), findsOneWidget);
  });
}
