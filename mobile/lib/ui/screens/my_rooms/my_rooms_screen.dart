import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:music_room/ui/widgets/widgets.dart';

class MyRoomsScreen extends StatelessWidget {
  const MyRoomsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;

    return Scaffold(
      appBar: AppBar(title: Text("My rooms", style: tt.titleLarge)),
      body: AppScreenBody(
        fillHeight: true,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [
            AppButton(
              label: 'TEST ROOM',
              onPressed: () => context.push('/room/12'),
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
