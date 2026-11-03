import 'package:flutter/material.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';

class DiscoverScreen extends StatelessWidget {
  const DiscoverScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(
        title: Text("Discover", style: tt.titleLarge),
        actions: [
          AppCreateRoomButton(),
          const SizedBox(width: Space.sm),
        ],
      ),
      body: AppScreenBody(
        fillHeight: true,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [Text("Implementation en cours", style: tt.titleLarge)],
        ),
      ),
    );
  }
}
