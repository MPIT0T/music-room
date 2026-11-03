enum RoomSelection { mine, friends, public }

enum RoomVisibility { public, private }

enum AccessPolicy {
  everyone('everyone'),
  invited('invited'),
  timeWindow('time_window');

  const AccessPolicy(this.apiValue);

  final String apiValue;
}

class Room {
  const Room({
    required this.id,
    required this.ownerId,
    required this.name,
    required this.visibility,
    required this.accessPolicy,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
    this.beaconMinor,
    this.description,
    this.windowStart,
    this.windowEnd,
  });

  final int version;
  final String id;
  final String ownerId;
  final String name;
  final String visibility;
  final String accessPolicy;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int? beaconMinor;
  final String? description;
  final DateTime? windowStart;
  final DateTime? windowEnd;

  factory Room.fromJson(Map<String, dynamic> j) {
    final window = j['window'] as Map<String, dynamic>?;

    return Room(
      id: j['id'] as String,
      ownerId: j['ownerId'] as String,
      name: j['name'] as String,
      description: j['description'] as String?,
      visibility: j['visibility'] as String,
      accessPolicy: j['accessPolicy'] as String,
      windowStart: window == null
          ? null
          : DateTime.parse(window['start'] as String),
      windowEnd: window == null
          ? null
          : DateTime.parse(window['end'] as String),
      beaconMinor: j['beaconMinor'] as int?,
      version: j['version'] as int,
      createdAt: DateTime.parse(j['createdAt']),
      updatedAt: DateTime.parse(j['updatedAt']),
    );
  }
}

/*
{
  "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "ownerId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "name": "string",
  "description": "string",
  "visibility": "public",
  "accessPolicy": "everyone",
  "window": {
    "start": "2026-11-02T12:57:57.901Z",
    "end": "2026-11-02T12:57:57.901Z"
  },
  "beaconMinor": 9007199254740991,
  "version": 9007199254740991,
  "createdAt": "2026-11-02T12:57:57.901Z",
  "updatedAt": "2026-11-02T12:57:57.901Z"
}
*/
