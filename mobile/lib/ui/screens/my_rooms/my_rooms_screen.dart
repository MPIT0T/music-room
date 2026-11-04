import 'package:flutter/material.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/data/models/room.dart';
import 'package:music_room/core/rooms_service.dart';
import 'package:music_room/core/services.dart';

class MyRoomsScreen extends StatefulWidget {
  const MyRoomsScreen({super.key});

  @override
  State<MyRoomsScreen> createState() => _MyRoomsScreenState();
}

class _MyRoomsScreenState extends State<MyRoomsScreen> {
  final RoomService _service = roomService;
  RoomSelection _selection = .mine;

  List<Room> _rooms = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rooms = await _service.listRoom();
      if (!mounted) return;
      setState(() {
        _rooms = rooms;
        _error = null;
      });
    } on RoomFailure catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

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
        scrollable: false,
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
            Expanded(
              child: ListView.builder(
                itemCount: _rooms.length,
                itemBuilder: (context, index) {
                  return ListTile(title: Text(_rooms[index].name));
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
