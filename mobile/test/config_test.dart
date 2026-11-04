import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/core/config.dart';

void main() {
  test('on this computer, the API is localhost:3000', () {
    expect(
      apiUrlForPage(Uri.parse('http://localhost:5000/#/welcome')),
      'http://localhost:3000',
    );
  });

  test('from another computer, the API is on the one that served the page', () {
    expect(
      apiUrlForPage(Uri.parse('http://z1r2p2.42lyon.fr:5000/')),
      'http://z1r2p2.42lyon.fr:3000',
    );
  });
}
