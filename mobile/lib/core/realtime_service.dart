import 'dart:async';

import 'package:flutter/foundation.dart';

import 'package:socket_io_client/socket_io_client.dart' as io;

import 'package:music_room/auth/session_store.dart';
import 'package:music_room/core/server_settings.dart';
import 'package:music_room/core/api_client.dart';

class RealtimeEvent {
  RealtimeEvent({required this.event, this.roomId});

  final String event;
  final String? roomId;
}

class RealtimeService {
  RealtimeService({
    required this._api,
    required this._server,
    required this._store,
  });

  // ponytail: fixed delay, add a backoff if many clients hammer a restarting server
  static const _retryDelay = Duration(seconds: 5);

  final ApiClient _api;
  final ServerSettings _server;
  final SessionStore _store;
  final Set<String> _roomIds = {};
  final _events = StreamController<RealtimeEvent>.broadcast();
  io.Socket? _socket;
  Timer? _retry;
  bool _retried = false;
  bool _wasConnected = false;

  Stream<RealtimeEvent> get events => _events.stream;

  void connect() {
    if (_socket != null) return;

    final socket = io.io(
      _server.baseUrl,
      io.OptionBuilder()
          .enableForceNew()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .setAuthFn(
            (send) async => send({'token': await _store.accessToken()}),
          )
          .build(),
    );

    for (final event in [
      'room.changed',
      'room.playback',
      'friends.changed',
      'delegations.changed',
    ]) {
      socket.on(event, (data) {
        final roomId = data['roomId'] as String?;
        _events.add(RealtimeEvent(event: event, roomId: roomId));
      });
    }

    _socket = socket
      ..onConnect((_) => _onConnect())
      ..onConnectError((err) => handleConnectError(err))
      ..onDisconnect(_onDisconnect)
      ..connect();
  }

  void subscribe(String roomId) {
    if (_roomIds.add(roomId) && (_socket?.connected ?? false)) {
      _sendSubscribe(roomId);
    }
  }

  void unsubscribe(String roomId) {
    // Not connected: nothing to leave, the next socket only joins what is in _roomIds
    if (_roomIds.remove(roomId) && (_socket?.connected ?? false)) {
      _socket!.emit('unsubscribe', {'roomId': roomId});
    }
  }

  void disconnect() {
    _retry?.cancel();
    _socket?.dispose();
    _socket = null;
    _roomIds.clear();
    _retried = false;
    _wasConnected = false;
  }

  void _onConnect() {
    _retried = false;
    for (final roomId in _roomIds) {
      _sendSubscribe(roomId);
    }
    // The first connection follows the screens' own GET: only a return needs a reload
    if (_wasConnected) _events.add(RealtimeEvent(event: 'reconnected'));
    _wasConnected = true;
  }

  /// A refused handshake makes the library give up: it never retries by itself.
  @visibleForTesting
  Future<void> handleConnectError(dynamic err) async {
    if (err is! Map || err['message'] != 'unauthorized') return;
    if (_retried) {
      // Even the refreshed token was refused: wait instead of looping on the server
      _retry = Timer(_retryDelay, _revive);
      return;
    }
    _retried = true;
    await _revive();
  }

  // Network loss reconnects by itself; a disconnect decided by the server does not
  void _onDisconnect(dynamic reason) {
    if (reason == 'io server disconnect') _revive();
  }

  // Refreshes first: a revoked device must end its session here, not reconnect with
  // an access token still valid for up to 15 minutes. A failure ending the session
  // calls disconnect(); any other one (server restarting) is retried.
  Future<void> _revive() async {
    _retry?.cancel();
    if (_socket == null) return;
    if (await _api.refreshSession()) {
      _socket?.connect();
    } else if (_socket != null) {
      _retry = Timer(_retryDelay, _revive);
    }
  }

  void _sendSubscribe(String roomId) => _socket!.emitWithAck(
    'subscribe',
    {'roomId': roomId},
    ack: (res) {
      // Forgotten so that the next subscribe() tries again
      if (res['ok'] != true) _roomIds.remove(roomId);
    },
  );
}
