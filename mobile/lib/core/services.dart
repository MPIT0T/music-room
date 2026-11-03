import 'package:music_room/auth/auth_service.dart';
import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/api_client.dart';
import 'package:music_room/core/client_info.dart';
import 'package:music_room/core/server_settings.dart';
import 'package:music_room/friends/friends_service.dart';

// Shared by the screens until the app gets a dependency-injection setup.
// One ApiClient for the whole app: its single-flight refresh only works if it is shared.
final serverSettings = ServerSettings();
final sessionStore = SessionStore();
final apiClient = ApiClient(
  server: serverSettings,
  store: sessionStore,
  userAgent: buildUserAgent,
);
final authService = AuthService(api: apiClient, store: sessionStore);
final friendsService = FriendsService(api: apiClient);
