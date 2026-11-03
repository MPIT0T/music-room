import 'package:flutter/material.dart';
import 'package:music_room/ui/widgets/widgets.dart';

class DiscoverScreen extends StatelessWidget {
  const DiscoverScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      body: AppScreenBody(
        fillHeight: true,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [Text("Discover", style: tt.titleLarge)],
        ),
      ),
    );
  }
}
