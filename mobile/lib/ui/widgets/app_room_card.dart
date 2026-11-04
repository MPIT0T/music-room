import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/data/models/room.dart';

class AppRoomCard extends StatelessWidget {
  const AppRoomCard({super.key, required this.room, required this.onTap});

  final Room room;
  final VoidCallback onTap;

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
              Text(room.name, style: tt.titleMedium),
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
