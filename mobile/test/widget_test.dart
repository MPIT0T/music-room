import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:music_room/features/dev/infra_test_screen.dart';

void main() {
  testWidgets('infra test screen renders with default backend URL', (
    tester,
  ) async {
    await tester.pumpWidget(const MaterialApp(home: InfraTest()));

    expect(find.text('Music Room infra test'), findsOneWidget);
    expect(find.text('http://10.0.2.2:3000'), findsOneWidget);
    expect(find.text('Health'), findsOneWidget);
  });
}
