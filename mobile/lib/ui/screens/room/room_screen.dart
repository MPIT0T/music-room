import 'dart:async';

import 'package:flutter/material.dart';
import 'package:music_room/core/queue_service.dart';
import 'package:music_room/core/realtime_service.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/data/models/queue_item.dart';

class RoomScreen extends StatefulWidget {
  const RoomScreen({super.key, required this.roomId});

  final String roomId;

  @override
  State<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends State<RoomScreen> {
  final _realtime = realtimeService;
  late final StreamSubscription<RealtimeEvent> _eventsSub;
  int _lastLoad = 0;

  RoomQueue? _queue;
  String? _error;

  @override
  void initState() {
    super.initState();
    _realtime.subscribe(widget.roomId);
    _load();
    _eventsSub = _realtime.events
        .where(
          (e) =>
              e.event == 'reconnected' ||
              (e.event == 'room.changed' && e.roomId == widget.roomId),
        )
        .listen((_) => _load());
  }

  @override
  void dispose() {
    // ponytail: no unsubscribe, MyRoomsScreen below shares this room and the set has no counter
    _eventsSub.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final load = ++_lastLoad;
    try {
      final queue = await queueService.queue(widget.roomId);
      if (!mounted || load != _lastLoad) return;
      setState(() {
        _queue = queue;
        _error = null;
      });
    } on QueueFailure catch (e) {
      if (mounted && load == _lastLoad) setState(() => _error = e.message);
    }
  }

  Future<void> _toggleVote(QueueItem item) async {
    try {
      if (item.myVote) {
        await queueService.unvote(widget.roomId, item.id);
      } else {
        await queueService.vote(widget.roomId, item.id);
      }
      await _load();
    } on QueueFailure catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  // Circle with the vote count; filled when I voted. Tap = vote / unvote.
  Widget _voteButton(QueueItem item) {
    final cs = Theme.of(context).colorScheme;
    return InkWell(
      customBorder: const CircleBorder(),
      onTap: () => _toggleVote(item),
      child: Container(
        width: 40,
        height: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: item.myVote ? cs.primary : null,
          border: Border.all(color: item.myVote ? cs.primary : cs.outline),
        ),
        child: Text(
          '${item.votes}',
          style: Theme.of(context).textTheme.labelSmall
              ?.copyWith(color: item.myVote ? cs.onPrimary : null),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final queue = _queue;
    return Scaffold(
      appBar: AppBar(title: const Text('Room')),
      body: queue == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Text(_error!),
            )
          : ListView(
              children: [
                if (queue.playing != null)
                  ListTile(
                    leading: const Icon(Icons.play_arrow),
                    title: Text(queue.playing!.track.title),
                    subtitle: Text(queue.playing!.track.artist),
                  ),
                if (queue.queue.isEmpty)
                  const ListTile(title: Text('No track in the queue yet.')),
                for (final item in queue.queue)
                  ListTile(
                    title: Text(item.track.title),
                    subtitle: Text(item.track.artist),
                    trailing: _voteButton(item),
                  ),
              ],
            ),
    );
  }
}
