import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/data/models/room.dart';

class AppRoomCard extends StatelessWidget {
  const AppRoomCard({
    super.key,
    required this.room,
    required this.onTap,
    this.onSettings,
  });

  final Room room;
  final VoidCallback onTap;
  final VoidCallback? onSettings;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

    return Card(
      clipBehavior: .antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: .all(Space.lg),
          child: Column(
            crossAxisAlignment: .start,
            spacing: Space.xs,
            children: [
              Row(
                children: [
                  Expanded(child: Text(room.name, style: tt.titleMedium)),
                  if (onSettings != null)
                    IconButton(
                      icon: const Icon(Icons.settings_outlined),
                      tooltip: 'Room settings',
                      onPressed: onSettings,
                    ),
                ],
              ),
              if (room.description != null)
                Text(room.description!, maxLines: 1, overflow: .ellipsis),
              Wrap(
                spacing: Space.sm,
                children: [
                  Chip(label: Text(room.accessPolicy)),
                  Text(room.visibility),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
