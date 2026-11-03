import 'package:flutter/material.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/data/models/room.dart';

class MyRoomsScreen extends StatefulWidget {
  const MyRoomsScreen({super.key});

  @override
  State<MyRoomsScreen> createState() => _MyRoomsScreenState();
}

class _MyRoomsScreenState extends State<MyRoomsScreen> {
  RoomSelection _selection = .mine;

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: Text("My rooms", style: tt.titleLarge),
        actions: [
          AppCreateRoomButton(),
          const SizedBox(width: Space.sm),
        ],
      ),
      body: AppScreenBody(
        fillHeight: true,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [
            SegmentedButton(
              segments: [
                ButtonSegment(value: RoomSelection.mine, label: Text('Mine')),
                ButtonSegment(
                  value: RoomSelection.friends,
                  label: Text('Friends'),
                ),
                ButtonSegment(
                  value: RoomSelection.public,
                  label: Text('Public'),
                ),
              ],
              selected: {_selection},
              onSelectionChanged: (s) => setState(() => _selection = s.first),
            ),
            const SizedBox(height: Space.md),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
