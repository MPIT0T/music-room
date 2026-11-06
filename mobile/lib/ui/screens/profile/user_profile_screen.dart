import 'package:flutter/material.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/data/models/friend.dart';
import 'package:music_room/data/models/profile.dart';
import 'package:music_room/friends/friends_service.dart';
import 'package:music_room/profile/profile_service.dart';
import 'package:music_room/ui/screens/profile/profile_header.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/ui/widgets/widgets.dart';

class UserProfileScreen extends StatefulWidget {
  // The services can be swapped in tests; the app uses the shared ones
  const UserProfileScreen({
    super.key,
    required this.userId,
    this.profiles,
    this.friends,
  });

  final String userId;
  final ProfileService? profiles;
  final FriendsService? friends;

  @override
  State<UserProfileScreen> createState() => _UserProfileScreenState();
}

class _UserProfileScreenState extends State<UserProfileScreen> {
  ProfileService get _profiles => widget.profiles ?? profileService;
  FriendsService get _friends => widget.friends ?? friendsService;

  UserProfile? _user;
  Friendship? _friendship; // null on my own profile: no friend button
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final user = await _profiles.user(widget.userId);
      final friendship = switch (user.relationship) {
        Relationship.self => null,
        Relationship.friend => Friendship.accepted,
        Relationship.none => await _pendingWith(user.id),
      };
      if (!mounted) return;
      setState(() {
        _user = user;
        _friendship = friendship;
        _error = null;
      });
    } on ProfileFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    } on FriendsFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  // The profile only says "friend or not": the pending requests tell who asked whom
  Future<Friendship> _pendingWith(String userId) async {
    final requests = await _friends.requests();
    bool from(List<FriendRequest> list) =>
        list.any((r) => r.user.userId == userId);
    if (from(requests.incoming)) return Friendship.incoming;
    if (from(requests.outgoing)) return Friendship.outgoing;
    return Friendship.none;
  }

  void _show(String message) => ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));

  /// Runs a friend action, confirms it with [done], then reloads: becoming
  /// friends or not changes what the profile shows.
  Future<void> _act(Future<void> Function() action, String done) async {
    setState(() => _busy = true);
    try {
      await action();
      if (!mounted) return;
      _show(done);
      await _load();
    } on FriendsFailure catch (e) {
      if (mounted) _show(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirmRemove(UserProfile user) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${user.displayName}?'),
        content: const Text('You will no longer control each other\'s music.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _act(() => _friends.remove(user.id), 'Friend removed.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final user = _user;
    return Scaffold(
      appBar: AppBar(
        title: Text(user?.displayName ?? 'Profile', style: tt.titleLarge),
      ),
      body: user == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Column(
                      mainAxisSize: .min,
                      children: [
                        Text(_error!),
                        TextButton(
                          onPressed: _load,
                          child: const Text('Retry'),
                        ),
                      ],
                    ),
            )
          : ListView(
              padding: const EdgeInsets.all(Space.screen),
              children: [
                ProfileHeader(
                  displayName: user.displayName,
                  bio: user.bio,
                  genres: user.genres,
                ),
                const SizedBox(height: Space.section),
                ..._friendsGroup(user, tt),
                const SizedBox(height: Space.section),
                ..._friendActions(user),
              ],
            ),
    );
  }

  // Shown only when the server sent it: to a friend, or on my own profile
  List<Widget> _friendsGroup(UserProfile user, TextTheme tt) {
    if (!user.friendsVisible) {
      return [
        Text(
          'Become friends to see their city and phone.',
          textAlign: TextAlign.center,
          style: tt.bodySmall,
        ),
      ];
    }
    return [
      Text('Friends only', style: tt.titleMedium),
      ListTile(
        leading: const Icon(Icons.location_city_outlined),
        title: const Text('City'),
        subtitle: Text(user.city ?? 'Not shared'),
      ),
      ListTile(
        leading: const Icon(Icons.phone_outlined),
        title: const Text('Phone'),
        subtitle: Text(user.phone ?? 'Not shared'),
      ),
    ];
  }

  List<Widget> _friendActions(UserProfile user) {
    final id = user.id;
    return switch (_friendship) {
      null => [const Text('This is you.', textAlign: TextAlign.center)],
      Friendship.none => [
        AppButton(
          label: 'Add friend',
          icon: Icons.person_add_alt,
          isLoading: _busy,
          onPressed: () => _act(() => _friends.add(id), 'Friend request sent.'),
        ),
      ],
      Friendship.outgoing => [
        Text(
          'Waiting for ${user.displayName} to accept.',
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: Space.sm),
        AppButton(
          label: 'Cancel request',
          variant: .secondary,
          isLoading: _busy,
          onPressed: () =>
              _act(() => _friends.remove(id), 'Friend request cancelled.'),
        ),
      ],
      Friendship.incoming => [
        AppButton(
          label: 'Accept request',
          icon: Icons.check,
          isLoading: _busy,
          onPressed: () => _act(() => _friends.add(id), 'You are now friends.'),
        ),
        const SizedBox(height: Space.sm),
        AppButton(
          label: 'Decline',
          variant: .secondary,
          isLoading: _busy,
          onPressed: () => _act(() => _friends.remove(id), 'Request declined.'),
        ),
      ],
      Friendship.accepted => [
        AppButton(
          label: 'Remove friend',
          variant: .danger,
          icon: Icons.person_remove_outlined,
          isLoading: _busy,
          onPressed: () => _confirmRemove(user),
        ),
      ],
    };
  }
}
