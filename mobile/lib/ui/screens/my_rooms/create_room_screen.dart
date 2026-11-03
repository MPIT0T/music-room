import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/rooms/rooms_service.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';
import 'package:music_room/data/models/room.dart';

class CreateRoomScreen extends StatefulWidget {
  const CreateRoomScreen({super.key});

  @override
  State<CreateRoomScreen> createState() => _CreateRoomScreenState();
}

class _CreateRoomScreenState extends State<CreateRoomScreen> {
  final TextEditingController _name = TextEditingController();
  final TextEditingController _descritpion = TextEditingController();
  RoomVisibility _visibility = .public;
  AccessPolicy _policy = .everyone;
  bool _isLoading = false;

  void _showError(BuildContext context, String message) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _submit() async {
    try {
      setState(() => _isLoading = true);
      final Room res = await roomService.createRoom(
        _name.text,
        _visibility,
        _policy,
        description: _descritpion.text.trim(),
      );
      if (!mounted) return;
      context.pushReplacement('/rooms/${res.id}');
    } on RoomFailure catch (e) {
      if (mounted) _showError(context, e.message);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close_rounded),
          tooltip: 'Close',
          onPressed: () => context.pop(),
        ),
        title: Text("Create your room", style: tt.titleLarge),
      ),
      body: AppScreenBody(
        fillHeight: true,
        maxWidth: 480,
        child: Column(
          children: [
            SegmentedButton(
              segments: [
                ButtonSegment(
                  value: RoomVisibility.public,
                  label: Text('Public'),
                  icon: Icon(Icons.public),
                ),
                ButtonSegment(
                  value: RoomVisibility.private,
                  label: Text('Private'),
                  icon: Icon(Icons.private_connectivity),
                ),
              ],
              selected: {_visibility},
              onSelectionChanged: (s) => setState(() => _visibility = s.first),
            ),
            const SizedBox(height: Space.sm),
            AppInput(label: 'Name', controller: _name),
            const SizedBox(height: Space.lg),
            AppInput(label: 'Description (optional)', controller: _descritpion),
            const SizedBox(height: Space.lg),
            RadioGroup(
              groupValue: _policy,
              onChanged: (v) => setState(() => _policy = v!),
              child: const Column(
                children: [
                  RadioListTile(
                    value: AccessPolicy.everyone,
                    title: Text("Everyone"),
                    subtitle: Text("Anyone who can see the room can vote"),
                  ),
                  RadioListTile(
                    value: AccessPolicy.invited,
                    title: Text("Invited only"),
                    subtitle: Text("Others can listen but not vote"),
                  ),
                  RadioListTile(
                    enabled: false,
                    value: AccessPolicy.timeWindow,
                    title: Text("Place and Time"),
                    subtitle: Text(
                      "Votes count only nearby, during a time window",
                    ),
                  ),
                ],
              ),
            ),
            const Spacer(),
            AppButton(
              label: 'Create room',
              isLoading: _isLoading,
              onPressed: _submit,
            ),
            const SizedBox(height: Space.lg),
          ],
        ),
      ),
    );
  }
}
