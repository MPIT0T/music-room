import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class AppCreateRoomButton extends StatelessWidget {
  const AppCreateRoomButton({super.key});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: const Icon(Icons.add_rounded),
      onPressed: () => context.push('rooms/new'),
    );
  }
}
