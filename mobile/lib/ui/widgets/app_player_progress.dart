import 'package:flutter/material.dart';

class AppPlayerProgress extends StatefulWidget {
  const AppPlayerProgress({
    super.key,
    required this.position,
    required this.duration,
    required this.onSeek,
  });

  final Stream<Duration> position;
  final Duration? duration;
  final ValueChanged<Duration> onSeek;

  @override
  State<AppPlayerProgress> createState() => _AppPlayerProgressState();
}

class _AppPlayerProgressState extends State<AppPlayerProgress> {
  double? _dragValue;

  String _format(Duration dur) {
    int hour = dur.inHours;
    String sec = (dur.inSeconds % 60).toString().padLeft(2, '0');
    String min = hour == 0
        ? (dur.inMinutes % 60).toString()
        : (dur.inMinutes % 60).toString().padLeft(2, '0');

    return hour == 0 ? '$min:$sec' : '$hour:$min:$sec';
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final Duration duration = widget.duration ?? .zero;

    return StreamBuilder<Duration>(
      stream: widget.position,
      builder: (context, snapshot) {
        final Duration position = snapshot.data ?? .zero;
        final double shown = (_dragValue ?? position.inSeconds)
            .clamp(0, duration.inSeconds.toDouble())
            .toDouble();

        return Column(
          children: [
            Slider(
              value: shown.toDouble(),
              max: duration.inSeconds.toDouble(),
              onChangeEnd: (double value) {
                widget.onSeek(Duration(seconds: value.toInt()));
                setState(() => _dragValue = null);
              },
              onChanged: (double value) {
                setState(() => _dragValue = value);
              },
            ),
            Row(
              mainAxisAlignment: .spaceBetween,
              children: [
                Text(
                  _format(Duration(seconds: shown.toInt())),
                  style: tt.bodySmall,
                ),
                Text(_format(duration), style: tt.bodySmall),
              ],
            ),
          ],
        );
      },
    );
  }
}
