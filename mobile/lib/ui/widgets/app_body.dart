import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';

class AppScreenBody extends StatelessWidget {
  const AppScreenBody({
    super.key,
    required this.child,
    this.maxWidth,
    this.fillHeight = false,
  });

  final Widget child;
  final bool fillHeight;
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    final padd = Padding(
      padding: const EdgeInsets.all(Space.screen),
      child: child,
    );
    final Widget scroll = fillHeight
        ? CustomScrollView(
            slivers: [SliverFillRemaining(hasScrollBody: false, child: padd)],
          )
        : SingleChildScrollView(child: padd);

    return SafeArea(
      child: Center(
        child: maxWidth == null
            ? scroll
            : ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 480),
                child: scroll,
              ),
      ),
    );
  }
}
