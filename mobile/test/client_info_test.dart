import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/core/client_info.dart';

// Same pattern as parseUserAgent in backend/src/logger.js
final apiPattern = RegExp(
  r'^MusicRoom/([^\s()]+) \((android|ios|web); ([^)]+)\)',
);

void main() {
  test('the User-Agent matches what the API logger parses', () {
    final ua = formatUserAgent('1.0.0', 'android', 'Pixel 7');

    expect(ua, 'MusicRoom/1.0.0 (android; Pixel 7)');
    final match = apiPattern.firstMatch(ua)!;
    expect([match[1], match[2], match[3]], ['1.0.0', 'android', 'Pixel 7']);
  });

  test('characters that would break the format are neutralized', () {
    final ua = formatUserAgent('1.0 beta', 'android', 'Evil); x (y\n');

    expect(apiPattern.hasMatch(ua), isTrue);
    expect(ua, isNot(contains('\n')));
    expect(apiPattern.firstMatch(ua)![1], '1.0beta');
  });

  test('empty values still give a parsable header', () {
    expect(apiPattern.hasMatch(formatUserAgent('', 'ios', '')), isTrue);
  });
}
