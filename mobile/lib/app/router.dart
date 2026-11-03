import 'package:go_router/go_router.dart';
import 'package:music_room/core/services.dart';
import 'package:music_room/ui/screens/screens.dart';
import 'package:music_room/app/shell.dart';

const _authScreens = {'/welcome', '/login', '/signup', '/forgot-password'};

abstract final class AppRouterConfig {
  static final GoRouter router = GoRouter(
    initialLocation: '/welcome',
    // Subject V.1: the app is used with an account. Signed in: the auth screens are skipped;
    // signed out: only the auth screens are reachable.
    redirect: (context, state) async {
      final signedIn = await sessionStore.hasSession();
      final onAuthScreen = _authScreens.contains(state.matchedLocation);
      if (signedIn && onAuthScreen) return '/discover';
      if (!signedIn && !onAuthScreen) return '/welcome';
      return null;
    },
    routes: [
      GoRoute(
        path: '/welcome',
        builder: (context, state) => const WelcomeScreen(),
      ),
      GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
      GoRoute(
        path: '/signup',
        builder: (context, state) => const SignupScreen(),
      ),
      GoRoute(
        path: '/forgot-password',
        builder: (context, state) => const ForgotPasswordScreen(),
      ),
      GoRoute(
        path: '/room/:id',
        builder: (context, state) {
          return const PlayerScreen();
        },
      ),
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
                    path: 'friends',
                    builder: (context, state) => const FriendsScreen(),
                    routes: [
                      GoRoute(
                        path: ':userId',
                        builder: (context, state) => const UserProfileScreen(),
                      ),
                    ],
                  ),
                  GoRoute(
                    path: 'edit-profile',
                    builder: (context, state) => const EditProfileScreen(),
                  ),
                  GoRoute(
                    path: 'settings',
                    builder: (context, state) => const SettingsScreen(),
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
