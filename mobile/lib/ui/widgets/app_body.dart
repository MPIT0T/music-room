import 'package:flutter/material.dart';
import 'package:music_room/ui/theme/tokens.dart';

class AppScreenBody extends StatelessWidget {
  const AppScreenBody({
    super.key,
    required this.child,
    this.maxWidth,
    this.fillHeight = false,
    this.scrollable = true,
  });

  final Widget child;
  final bool fillHeight;
  final bool scrollable;
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    final padd = Padding(
      padding: const EdgeInsets.all(Space.screen),
      child: child,
    );

    final Widget content = !scrollable
        ? padd
        : fillHeight
        ? CustomScrollView(
            slivers: [SliverFillRemaining(hasScrollBody: false, child: padd)],
          )
        : SingleChildScrollView(child: padd);

    return SafeArea(
      child: Center(
        child: maxWidth == null
            ? content
            : ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxWidth!),
                child: content,
              ),
      ),
    );
  }
}
