import 'dart:async';

import 'package:flutter/material.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/data/models/room.dart';
import 'package:music_room/core/rooms_service.dart';
import 'package:music_room/core/realtime_service.dart';
import 'package:music_room/core/services.dart';
import 'package:go_router/go_router.dart';

class MyRoomsScreen extends StatefulWidget {
  const MyRoomsScreen({super.key});

  @override
  State<MyRoomsScreen> createState() => _MyRoomsScreenState();
}

class _MyRoomsScreenState extends State<MyRoomsScreen> {
  final RoomService _service = roomService;
  RoomSelection _selection = .mine;

  final _realtime = realtimeService;
  late final StreamSubscription<RealtimeEvent> _eventsSub;
  Timer? _reloadTimer;
  int _lastLoad = 0;

  List<Room> _rooms = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
    _eventsSub = _realtime.events
        .where((e) => e.event == 'room.changed' || e.event == 'reconnected')
        .listen((_) => _scheduleReload());
  }

  @override
  void dispose() {
    for (final room in _rooms) {
      _realtime.unsubscribe(room.id);
    }
    _eventsSub.cancel();
    _reloadTimer?.cancel();
    super.dispose();
  }

  // A burst of events ends in a single GET
  void _scheduleReload() {
    _reloadTimer?.cancel();
    _reloadTimer = Timer(const Duration(milliseconds: 300), _load);
  }

  Future<void> _load() async {
    final load = ++_lastLoad;
    try {
      final rooms = await _service.listRoom();
      // A newer request was sent meanwhile: its answer is the one to keep
      if (!mounted || load != _lastLoad) return;
      final ids = rooms.map((room) => room.id).toSet();
      final removed = _rooms.map((room) => room.id).toSet().difference(ids);
      setState(() {
        _rooms = rooms;
        _error = null;
      });
      removed.forEach(_realtime.unsubscribe);
      ids.forEach(_realtime.subscribe);
    } on RoomFailure catch (e) {
      if (mounted && load == _lastLoad) setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: Text("My rooms", style: tt.titleLarge),
        actions: [
          AppCreateRoomButton(),
          const SizedBox(width: Space.sm),
        ],
      ),
      body: AppScreenBody(
        scrollable: false,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [
            Text(_error ?? 'No Error'),
            SegmentedButton(
              segments: [
                ButtonSegment(value: RoomSelection.mine, label: Text('Mine')),
                ButtonSegment(
                  value: RoomSelection.friends,
                  label: Text('Friends'),
                ),
                ButtonSegment(
                  value: RoomSelection.public,
                  label: Text('Public'),
                ),
              ],
              selected: {_selection},
              onSelectionChanged: (s) => setState(() => _selection = s.first),
            ),
            const SizedBox(height: Space.md),
            Expanded(
              child: ListView.separated(
                itemCount: _rooms.length,
                itemBuilder: (context, index) => AppRoomCard(
                  room: _rooms[index],
                  onTap: () => context.push('/rooms/${_rooms[index].id}'),
                ),
                separatorBuilder: (_, _) =>
                    const SizedBox(height: Space.cardGap),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
