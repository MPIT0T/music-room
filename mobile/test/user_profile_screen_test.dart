import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/data/models/friend.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/friends/friends_service.dart';
import 'package:music_room/profile/profile_service.dart';
import 'package:music_room/ui/screens/profile/user_profile_screen.dart';

// Fake services: one user, Nina, whose profile depends on the friendship
class FakeProfileService extends Fake implements ProfileService {
  var relationship = Relationship.none;

  @override
  Future<UserProfile> user(String id) async {
    final visible = relationship != Relationship.none;
    return UserProfile(
      id: id,
      relationship: relationship,
      displayName: 'Nina',
      bio: 'Folk on vinyl',
      genres: const [Genre(id: 9, name: 'Folk')],
      friendsVisible: visible,
      city: visible ? 'Lyon' : null,
      phone: visible ? '+33 6 12 34 56 78' : null,
    );
  }
}

// Changes the friendship like the server would, so the reloaded profile follows
class FakeFriendsService extends Fake implements FriendsService {
  FakeFriendsService(this.profiles);

  final FakeProfileService profiles;
  final incoming = <FriendRequest>[];
  final outgoing = <FriendRequest>[];
  final actions = <String>[];

  @override
  Future<FriendRequests> requests() async =>
      (incoming: List.of(incoming), outgoing: List.of(outgoing));

  @override
  Future<bool> add(String userId) async {
    actions.add('add $userId');
    if (incoming.any((r) => r.user.userId == userId)) {
      incoming.clear();
      profiles.relationship = Relationship.friend;
      return true;
    }
    outgoing.add(requestFrom(userId));
    return false;
  }

  @override
  Future<void> remove(String userId) async {
    actions.add('remove $userId');
    incoming.clear();
    outgoing.clear();
    profiles.relationship = Relationship.none;
  }
}

FriendRequest requestFrom(String userId) => FriendRequest(
  user: UserSummary(userId: userId, displayName: 'Nina'),
  createdAt: DateTime.utc(2026, 11, 5),
);

void main() {
  late FakeProfileService profiles;
  late FakeFriendsService friends;

  setUp(() {
    profiles = FakeProfileService();
    friends = FakeFriendsService(profiles);
  });

  Future<void> open(WidgetTester tester) async {
    // Tall enough for the whole page: a ListView only builds what is on screen
    tester.view.physicalSize = const Size(800, 2000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        home: UserProfileScreen(
          userId: 'n1',
          profiles: profiles,
          friends: friends,
        ),
      ),
    );
    await tester.pumpAndSettle(); // waits for the profile and the requests
  }

  testWidgets('a stranger sees the public group only', (tester) async {
    await open(tester);

    expect(find.text('Folk on vinyl'), findsOneWidget);
    expect(find.text('Folk'), findsOneWidget);
    expect(find.text('Lyon'), findsNothing);
    expect(
      find.text('Become friends to see their city and phone.'),
      findsOneWidget,
    );
    expect(find.text('Add friend'), findsOneWidget);
  });

  testWidgets('a friend also sees the friends group', (tester) async {
    profiles.relationship = Relationship.friend;
    await open(tester);

    expect(find.text('Friends only'), findsOneWidget);
    expect(find.text('Lyon'), findsOneWidget);
    expect(find.text('+33 6 12 34 56 78'), findsOneWidget);
    expect(find.text('Remove friend'), findsOneWidget);
  });

  testWidgets('my own profile has no friend button', (tester) async {
    profiles.relationship = Relationship.self;
    await open(tester);

    expect(find.text('Lyon'), findsOneWidget);
    expect(find.text('This is you.'), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
  });

  testWidgets('adding a stranger sends a request', (tester) async {
    await open(tester);

    await tester.tap(find.text('Add friend'));
    await tester.pumpAndSettle();

    expect(friends.actions, ['add n1']);
    expect(find.text('Waiting for Nina to accept.'), findsOneWidget);
    expect(find.text('Cancel request'), findsOneWidget);
  });

  testWidgets('a request received can be accepted', (tester) async {
    friends.incoming.add(requestFrom('n1'));
    await open(tester);

    expect(find.text('Decline'), findsOneWidget);
    await tester.tap(find.text('Accept request'));
    await tester.pumpAndSettle();

    expect(friends.actions, ['add n1']);
    expect(find.text('Lyon'), findsOneWidget); // the friends group appears
  });

  testWidgets('removing a friend asks first', (tester) async {
    profiles.relationship = Relationship.friend;
    await open(tester);

    await tester.tap(find.text('Remove friend'));
    await tester.pumpAndSettle();
    expect(find.text('Remove Nina?'), findsOneWidget);

    await tester.tap(find.text('Remove'));
    await tester.pumpAndSettle();

    expect(friends.actions, ['remove n1']);
    expect(find.text('Add friend'), findsOneWidget);
  });
}
