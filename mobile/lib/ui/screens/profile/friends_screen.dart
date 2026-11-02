import 'package:flutter/material.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';

class FriendsScreen extends StatelessWidget {
  const FriendsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text("Friends", style: tt.titleLarge)),
      body: AppScreenBody(
        maxWidth: 480,
        fillHeight: true,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [
            const SizedBox(height: Space.sm),
            Card(
              child: SizedBox(
                height: 50,
                width: 480,
                child: Text(
                  'TODO Search Bar, Search people by name ? Dont show people and just send invite ?',
                ),
              ),
            ),
            const SizedBox(height: Space.section),
            Text('Pending Requests', style: tt.titleMedium),
            const SizedBox(height: Space.sm),
            Card(
              child: Column(
                children: [
                  Text('TODO: Photo, name, desc, Decline|Accept'),
                  const SizedBox(height: Space.xs),
                  Text('TODO: Photo, name, desc: You sent a request?, Cancel'),
                ],
              ),
            ),
            const SizedBox(height: Space.section),
            Text('Your friends - 12', style: tt.titleMedium),
            const SizedBox(height: Space.sm),
            Card(
              child: SizedBox(
                height: 100,
                width: 480,
                child: Text('TODO: Photo, name, '),
              ),
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
