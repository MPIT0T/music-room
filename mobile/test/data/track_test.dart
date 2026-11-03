import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/data/models/track.dart';

void main() {
  test('parse un morceau Jamendo', () {
    final json = jsonDecode(
      File('assets/dev/jamendo_track.json').readAsStringSync(),
    );
    final track = Track.fromJamendo((json['results'] as List).first);

    expect(track.name, 'Simple Exercice');
    expect(track.duration, const Duration(seconds: 340));
    expect(track.audioUrl, startsWith('https://'));
  });
}
