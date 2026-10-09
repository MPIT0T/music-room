import 'package:go_router/go_router.dart';
import 'package:music_room/ui/screens/discover/discover_screen.dart';
import 'package:music_room/ui/screens/my_rooms/my_rooms_screen.dart';
import 'package:music_room/ui/screens/profile/profile_screen.dart';
import 'package:music_room/ui/screens/profile/friends_screen.dart';
import 'package:music_room/ui/screens/profile/user_profile_screen.dart';
import 'package:music_room/app/shell.dart';

abstract final class AppRouterConfig {
  static final GoRouter router = GoRouter(
    initialLocation: '/discover',
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AppShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/discover',
                builder: (context, state) => const DiscoverScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/my-rooms',
                builder: (context, state) => const MyRoomsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/profile',
                builder: (context, state) => const ProfileScreen(),
                routes: [
                  GoRoute(
                    path: '/friends',
                    builder: (context, state) => const FriendsScreen(),
                    routes: [
                      GoRoute(
                        path: '/:userId',
                        builder: (context, state) => const UserProfileScreen(),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );
}
