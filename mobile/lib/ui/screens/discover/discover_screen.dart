import 'package:flutter/material.dart';
import 'package:music_room/ui/widgets/widgets.dart';
import 'package:music_room/ui/theme/tokens.dart';

class DiscoverScreen extends StatelessWidget {
  const DiscoverScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      body: AppScreenBody(
        fillHeight: true,
        child: Column(
          mainAxisAlignment: .spaceBetween,
          crossAxisAlignment: .stretch,
          children: [
            Padding(
              padding: .symmetric(horizontal: Space.screen),
              child: Row(
                children: [
                  Text('Discover', style: tt.titleLarge),
                  const Spacer(),
                  TextButton(
                    onPressed: () {},
                    child: CircleAvatar(
                      backgroundColor: cs.onSurface,
                      radius: 15,
                      child: CircleAvatar(
                        radius: 14,
                        backgroundColor: cs.surface,
                        child: Icon(Icons.add, color: cs.onSurface),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const Card(child: Text('Search bar')),
            const SizedBox(height: Space.cardGap),
            const Card(child: Text('Near me')),
            const SizedBox(height: Space.section),
            Text('Public rooms', style: tt.titleSmall),
            const Card(child: Text('Room num 1')),
            const Card(child: Text('Room num 2')),
            const Card(child: Text('Room num 3')),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
