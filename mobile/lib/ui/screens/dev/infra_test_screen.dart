import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';

class InfraTest extends StatefulWidget {
  const InfraTest({super.key});
  @override
  State<InfraTest> createState() => _InfraTestState();
}

class _InfraTestState extends State<InfraTest> {
  final _url = TextEditingController(text: 'http://10.0.2.2:3000');
  final _lines = <String>[];
  WebSocketChannel? _ws;

  Map<String, String> get _headers => {
    'X-Platform': Platform.operatingSystem,
    'X-Device': 'test-device',
    'X-App-Version': '0.1.0',
  };

  void _log(String s) => setState(() => _lines.insert(0, s));

  Future<void> _call(String method, String path) async {
    final uri = Uri.parse('${_url.text}$path');
    try {
      final res = method == 'GET'
          ? await http.get(uri, headers: _headers)
          : await http.post(uri, headers: _headers);
      _log('$method $path -> ${res.statusCode} ${res.body}');
    } catch (e) {
      _log('$method $path -> ERROR $e');
    }
  }

  void _connectWs() {
    _ws?.sink.close();
    final uri = Uri.parse('${_url.text.replaceFirst('http', 'ws')}/ws');
    _ws = WebSocketChannel.connect(uri);
    _ws!.stream.listen(
      (m) => _log('WS <- $m'),
      onError: (e) => _log('WS ERROR $e'),
      onDone: () => _log('WS closed'),
    );
    _log('WS connecting to $uri');
  }

  void _sendWs() {
    final msg = 'hello ${DateTime.now().toIso8601String()}';
    _ws?.sink.add(msg);
    _log('WS -> $msg');
  }

  @override
  void dispose() {
    _ws?.sink.close();
    _url.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Music Room infra test')),
      body: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            TextField(
              controller: _url,
              decoration: const InputDecoration(labelText: 'Backend URL'),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                ElevatedButton(
                  onPressed: () => _call('GET', '/health'),
                  child: const Text('Health'),
                ),
                ElevatedButton(
                  onPressed: () => _call('POST', '/ping'),
                  child: const Text('Ping'),
                ),
                ElevatedButton(
                  onPressed: _connectWs,
                  child: const Text('WS connect'),
                ),
                ElevatedButton(
                  onPressed: _sendWs,
                  child: const Text('WS send'),
                ),
              ],
            ),
            const Divider(),
            Expanded(
              child: ListView(children: _lines.map((l) => Text(l)).toList()),
            ),
          ],
        ),
      ),
    );
  }
}
