import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:music_room/data/models/playback_status.dart';
import 'package:music_room/data/models/queue.dart';

import 'package:music_room/data/models/track.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/core/rooms_service.dart';
import 'package:music_room/core/services.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key, required this.roomId});

  final String roomId;

  @override
  State<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends State<PlayerScreen> {
  final _player = AudioPlayer();
  late final Stream<PlayerState> playerStateStream = _player.playerStateStream;
  late final Stream<PlaybackStatus> playbackStatus = playerStateStream.map((p) {
    if (p.processingState == .completed) return .loading;
    if (p.processingState == .loading) return .paused;
    return p.playing ? .playing : .paused;
  });

  final RoomService _rooms = roomService;
  QueueItem? _playing;
  String? _error;

  Track? get _track => _playing?.track;

  @override
  void initState() {
    super.initState();

    _load();
  }

  Future<void> _load() async {
    try {
      final q = await _rooms.queue(widget.roomId);
      if (q.playing == null && q.queue.isNotEmpty) {
        _rooms.skip(widget.roomId);
        return;
      }
      if (!mounted) return;
      setState(() => _playing = q.playing);
      if (_playing != null) _startPlaying(_playing!.track);
    } on RoomFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  Future<void> _startPlaying(Track track) async {
    try {
      final url = await _rooms.streamUrl(track.id);
      _player.setUrl(url);
    } on RoomFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: Text("Room Name", style: tt.titleMedium)),
      body: AppScreenBody(
        fillHeight: true,
        maxWidth: 480,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [
            const Spacer(),
            Padding(
              padding: .all(Space.cardGap),
              child: AppTrackCover(imageUrl: _track?.coverUrl),
            ),
            Text(_track?.title ?? 'Unknown', style: tt.titleMedium),
            Row(
              children: [
                Text(
                  _track?.artist ?? 'Unknown',
                  style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                ),
                Text(
                  ' - x Votes',
                  style: tt.bodySmall?.copyWith(color: cs.onSurfaceVariant),
                ),
              ],
            ),
            const SizedBox(height: Space.sm),
            AppPlayerProgress(
              position: _player.positionStream,
              duration: _track?.durationMs,
              onSeek: _player.seek,
            ),
            const SizedBox(height: Space.xl),
            Row(
              children: [
                const Spacer(),
                IconButton.outlined(
                  style: IconButton.styleFrom(minimumSize: const Size(60, 60)),
                  onPressed: null,
                  icon: const Icon(Icons.fast_rewind_outlined),
                ),
                const SizedBox(width: Space.xxxl),
                AppPlayerButton(
                  status: playbackStatus,
                  onPlay: _player.play,
                  onPause: _player.pause,
                ),
                const SizedBox(width: Space.xxxl),
                IconButton.outlined(
                  style: IconButton.styleFrom(minimumSize: const Size(60, 60)),
                  onPressed: null,
                  icon: const Icon(Icons.fast_forward_outlined),
                ),
                const Spacer(),
              ],
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
