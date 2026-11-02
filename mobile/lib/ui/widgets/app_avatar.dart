import 'package:flutter/material.dart';

class AppAvatar extends StatelessWidget {
  const AppAvatar({super.key, required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return CircleAvatar(
      radius: 72,
      backgroundColor: cs.surface,
      child: Text(label.characters.first, style: tt.titleLarge),
    );
  }
}
