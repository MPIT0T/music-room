import 'package:flutter/material.dart';
import 'package:music_room/ui/widgets/app_body.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final tt = Theme.of(context).textTheme;
    return Scaffold(
      body: AppScreenBody(
        fillHeight: true,
        child: Column(
          crossAxisAlignment: .stretch,
          children: [Text("Profile", style: tt.titleLarge)],
        ),
      ),
    );
  }
}
