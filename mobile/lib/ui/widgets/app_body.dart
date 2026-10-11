import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';

class AppScreenBody extends StatelessWidget {
  const AppScreenBody({
    super.key,
    required this.child,
    this.fillHeight = false,
  });

  final Widget child;
  final bool fillHeight;

  @override
  Widget build(BuildContext context) {
    final padd = Padding(padding: const EdgeInsets.all(Space.lg), child: child);
    return SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: fillHeight
              ? CustomScrollView(
                  slivers: [
                    SliverFillRemaining(hasScrollBody: false, child: padd),
                  ],
                )
              : SingleChildScrollView(child: padd),
        ),
      ),
    );
  }
}
