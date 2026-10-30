import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:music_room/data/models/playback_status.dart';

import 'package:music_room/data/models/track.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';

class PlayerScreen extends StatefulWidget {
  const PlayerScreen({super.key});

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
  Track? _track;

  @override
  void initState() {
    super.initState();

    // TODO: _player.setUrl(widget.track.audioUrl);
    _load();
  }

  Future<void> _load() async {
    final raw = await rootBundle.loadString('assets/dev/jamendo_track.json');
    final track = Track.fromJamendo((jsonDecode(raw)['results'] as List).first);
    if (!mounted) return;
    setState(() => _track = track);
    try {
      await _player.setUrl(_track!.audioUrl);
    } catch (e) {
      if (!mounted) return;
      setState(() => _track = null);
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
            Text(_track?.name ?? 'Unknown', style: tt.titleMedium),
            Row(
              children: [
                Text(
                  _track?.artistName ?? 'Unknown',
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
              duration: _track?.duration,
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
