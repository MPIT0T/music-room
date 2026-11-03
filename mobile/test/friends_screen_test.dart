import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/data/models/friend.dart';
import 'package:music_room/friends/friends_service.dart';
import 'package:music_room/ui/screens/profile/friends_screen.dart';

// A fake service: answers from memory and records the actions
class FakeFriendsService implements FriendsService {
  final friends = [const UserSummary(userId: 'f1', displayName: 'Max')];
  final incoming = [
    FriendRequest(
      user: const UserSummary(userId: 'i1', displayName: 'Ann'),
      createdAt: DateTime.utc(2026, 11, 3),
    ),
  ];
  final outgoing = <FriendRequest>[];
  final actions = <String>[];
  FriendsFailure? failure;

  @override
  Future<List<UserSummary>> list() async => List.of(friends);

  @override
  Future<FriendRequests> requests() async =>
      (incoming: List.of(incoming), outgoing: List.of(outgoing));

  final searches = <String>[];

  @override
  Future<List<SearchResult>> search(String query) async {
    searches.add(query);
    return [
      const SearchResult(
        user: UserSummary(userId: 'n1', displayName: 'Nina'),
        friendship: Friendship.none,
      ),
    ];
  }

  @override
  Future<bool> add(String userId) async {
    if (failure != null) throw failure!;
    actions.add('add $userId');
    final i = incoming.indexWhere((r) => r.user.userId == userId);
    if (i == -1) return false; // a new request, nothing to move
    friends.add(incoming.removeAt(i).user);
    return true;
  }

  @override
  Future<void> remove(String userId) async {
    actions.add('remove $userId');
    incoming.removeWhere((r) => r.user.userId == userId);
    friends.removeWhere((f) => f.userId == userId);
  }
}

void main() {
  late FakeFriendsService service;

  setUp(() => service = FakeFriendsService());

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(MaterialApp(home: FriendsScreen(service: service)));
    await tester.pumpAndSettle(); // waits for _load
  }

  testWidgets('shows requests received and friends', (tester) async {
    await open(tester);

    expect(find.text('Requests received'), findsOneWidget);
    expect(find.text('Ann'), findsOneWidget);
    expect(find.text('Your friends - 1'), findsOneWidget);
    expect(find.text('Max'), findsOneWidget);
    expect(find.text('Requests sent'), findsNothing); // empty section hidden
  });

  testWidgets('accepting a request moves it to the friends', (tester) async {
    await open(tester);

    await tester.tap(find.byTooltip('Accept'));
    await tester.pumpAndSettle();

    expect(service.actions, ['add i1']);
    expect(find.text('Requests received'), findsNothing);
    expect(find.text('Your friends - 2'), findsOneWidget);
  });

  testWidgets('removing a friend asks first', (tester) async {
    await open(tester);

    await tester.tap(find.byTooltip('Remove'));
    await tester.pumpAndSettle();
    expect(find.text('Remove Max?'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Remove'));
    await tester.pumpAndSettle();

    expect(service.actions, ['remove f1']);
    expect(find.text('Your friends - 0'), findsOneWidget);
  });

  testWidgets('an error is shown in a SnackBar', (tester) async {
    service.failure = const FriendsFailure('rate_limited', 'Slow down.');
    await open(tester);

    await tester.tap(find.byTooltip('Accept'));
    await tester.pumpAndSettle();

    expect(find.text('Slow down.'), findsOneWidget);
    expect(find.text('Ann'), findsOneWidget); // nothing changed
  });

  testWidgets('search waits for a pause, then offers to add', (tester) async {
    await open(tester);

    await tester.enterText(find.byType(TextField), 'N');
    await tester.enterText(find.byType(TextField), 'Ni');
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pumpAndSettle();

    expect(service.searches, ['Ni']); // one call for two keystrokes
    expect(find.text('Nina'), findsOneWidget);

    await tester.tap(find.widgetWithText(TextButton, 'Add'));
    await tester.pumpAndSettle();
    expect(service.actions, ['add n1']);
  });
}
