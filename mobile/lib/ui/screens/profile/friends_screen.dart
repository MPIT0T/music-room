import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/core/realtime_service.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/data/models/friend.dart';
import 'package:music_room/friends/friends_service.dart';
import 'package:music_room/ui/theme/tokens.dart';

class FriendsScreen extends StatefulWidget {
  // The service and the events can be swapped in tests; the app uses the shared ones
  const FriendsScreen({super.key, this.service, this.events});

  final FriendsService? service;
  final Stream<RealtimeEvent>? events;

  @override
  State<FriendsScreen> createState() => _FriendsScreenState();
}

class _FriendsScreenState extends State<FriendsScreen> {
  FriendsService get _service => widget.service ?? friendsService;

  List<UserSummary> _friends = [];
  List<FriendRequest> _incoming = [];
  List<FriendRequest> _outgoing = [];
  bool _loading = true;
  String? _error;
  int _lastLoad = 0;

  late final StreamSubscription<RealtimeEvent> _eventsSub;
  Timer? _reloadTimer;

  final _searchField = TextEditingController();
  List<SearchResult> _results = [];
  Timer? _debounce;
  int _searchId = 0;

  @override
  void initState() {
    super.initState();
    _load();
    // Sent to both users when a request is sent, accepted, declined or removed
    _eventsSub = (widget.events ?? realtimeService.events)
        .where((e) => e.event == 'friends.changed' || e.event == 'reconnected')
        .listen((_) => _scheduleReload());
  }

  @override
  void dispose() {
    _eventsSub.cancel();
    _reloadTimer?.cancel();
    _debounce?.cancel();
    _searchField.dispose();
    super.dispose();
  }

  // The search route allows 30 calls a minute: wait for a pause in typing
  void _onSearchChanged(String text) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), _search);
  }

  Future<void> _search() async {
    final query = _searchField.text.trim();
    // Each search gets a number: an answer that arrives after a newer search is dropped
    final id = ++_searchId;
    if (query.isEmpty) {
      setState(() => _results = []);
      return;
    }
    try {
      final results = await _service.search(query);
      if (mounted && id == _searchId) setState(() => _results = results);
    } on FriendsFailure catch (e) {
      if (mounted) _showError(e);
    }
  }

  void _showError(FriendsFailure e) =>
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));

  // A burst of events ends in a single reload
  void _scheduleReload() {
    _reloadTimer?.cancel();
    _reloadTimer = Timer(const Duration(milliseconds: 300), _reload);
  }

  Future<void> _load() async {
    final load = ++_lastLoad;
    try {
      // Both calls run at the same time; the screen waits for the slower one
      final (friends, requests) = await (
        _service.list(),
        _service.requests(),
      ).wait;
      // A newer request was sent meanwhile: its answer is the one to keep
      if (!mounted || load != _lastLoad) return;
      setState(() {
        _friends = friends;
        _incoming = requests.incoming;
        _outgoing = requests.outgoing;
        _error = null;
      });
    } on FriendsFailure catch (e) {
      if (mounted && load == _lastLoad) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Runs an action (accept, refuse, cancel, remove), then reloads the lists.
  Future<void> _act(Future<void> Function() action) async {
    try {
      await action();
      await _reload();
    } on FriendsFailure catch (e) {
      if (mounted) _showError(e);
    }
  }

  Future<void> _reload() async {
    await _load();
    if (_results.isNotEmpty) await _search();
  }

  // The friendship can change on the profile page: the lists are reloaded on return
  Future<void> _openProfile(UserSummary user) async {
    await context.push('/profile/friends/${user.userId}');
    if (mounted) await _reload();
  }

  Future<void> _confirmRemove(UserSummary friend) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${friend.displayName}?'),
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
    if (confirmed == true) await _act(() => _service.remove(friend.userId));
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text('Friends', style: tt.titleLarge)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(Space.screen),
                children: [
                  TextField(
                    controller: _searchField,
                    onChanged: _onSearchChanged,
                    decoration: const InputDecoration(
                      hintText: 'Search people by name',
                      prefixIcon: Icon(Icons.search),
                    ),
                  ),
                  for (final r in _results)
                    ListTile(
                      leading: _avatar(r.user),
                      title: Text(r.user.displayName),
                      onTap: () => _openProfile(r.user),
                      trailing: _searchAction(r),
                    ),
                  const SizedBox(height: Space.section),
                  if (_error != null) ...[
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                    const SizedBox(height: Space.section),
                  ],
                  if (_incoming.isNotEmpty) ...[
                    Text('Requests received', style: tt.titleMedium),
                    for (final r in _incoming)
                      ListTile(
                        leading: _avatar(r.user),
                        title: Text(r.user.displayName),
                        onTap: () => _openProfile(r.user),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: 'Decline',
                              icon: const Icon(Icons.close),
                              onPressed: () =>
                                  _act(() => _service.remove(r.user.userId)),
                            ),
                            IconButton(
                              tooltip: 'Accept',
                              icon: const Icon(Icons.check),
                              onPressed: () =>
                                  _act(() => _service.add(r.user.userId)),
                            ),
                          ],
                        ),
                      ),
                    const SizedBox(height: Space.section),
                  ],
                  if (_outgoing.isNotEmpty) ...[
                    Text('Requests sent', style: tt.titleMedium),
                    for (final r in _outgoing)
                      ListTile(
                        leading: _avatar(r.user),
                        title: Text(r.user.displayName),
                        onTap: () => _openProfile(r.user),
                        trailing: TextButton(
                          onPressed: () =>
                              _act(() => _service.remove(r.user.userId)),
                          child: const Text('Cancel'),
                        ),
                      ),
                    const SizedBox(height: Space.section),
                  ],
                  Text(
                    'Your friends - ${_friends.length}',
                    style: tt.titleMedium,
                  ),
                  if (_friends.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: Space.lg),
                      child: Text('No friends yet.'),
                    ),
                  for (final f in _friends)
                    ListTile(
                      leading: _avatar(f),
                      title: Text(f.displayName),
                      onTap: () => _openProfile(f),
                      trailing: IconButton(
                        tooltip: 'Remove',
                        icon: const Icon(Icons.person_remove_outlined),
                        onPressed: () => _confirmRemove(f),
                      ),
                    ),
                ],
              ),
            ),
    );
  }

  Widget _searchAction(SearchResult r) {
    final id = r.user.userId;
    return switch (r.friendship) {
      Friendship.none => TextButton(
        onPressed: () => _act(() => _service.add(id)),
        child: const Text('Add'),
      ),
      Friendship.incoming => TextButton(
        onPressed: () => _act(() => _service.add(id)),
        child: const Text('Accept'),
      ),
      Friendship.outgoing => TextButton(
        onPressed: () => _act(() => _service.remove(id)),
        child: const Text('Cancel'),
      ),
      Friendship.accepted => const Text('Friend'),
    };
  }

  // First letter of the name until avatars are served by the API
  Widget _avatar(UserSummary user) =>
      CircleAvatar(child: Text(user.displayName.characters.first));
}
