// Scenario: every virtual user votes in its room as fast as the API answers.
// First iteration: a vote for each queue item. Then: remove a vote and put it back.
// At the end each item must count exactly one vote per user of its room: none lost, none doubled.
import http from "k6/http";
import { check, fail } from "k6";
import { SharedArray } from "k6/data";
import { Counter } from "k6/metrics";

const API_URL = __ENV.API_URL ?? "http://api:3000";
const VUS = Number(__ENV.VUS ?? 50);

const data = JSON.parse(open("./.data.json"));
const users = new SharedArray("users", () => data.users);
const rooms = new SharedArray("rooms", () => data.rooms);

const votesSent = new Counter("votes_sent");
const voteMismatches = new Counter("vote_mismatches");

export const options = {
  scenarios: {
    voters: {
      executor: "ramping-vus",
      stages: [
        { duration: "30s", target: VUS },
        { duration: "1m", target: VUS },
        { duration: "10s", target: 0 },
      ],
      // An iteration is a DELETE then a PUT: let it finish so the final count is exact
      gracefulRampDown: "30s",
      gracefulStop: "30s",
    },
  },
  thresholds: {
    "http_req_duration{kind:vote}": ["p(95)<500"],
    "http_req_failed{kind:vote}": ["rate<0.01"],
    vote_mismatches: ["count==0"],
    checks: ["rate>0.99"],
  },
};

const auth = (token) => ({
  headers: { Authorization: `Bearer ${token}` },
  tags: { kind: "vote" },
});
const voteUrl = (roomId, itemId) =>
  `${API_URL}/v1/rooms/${roomId}/tracks/${itemId}/vote`;

// SharedArray only offers length, [i] and for...of: no find, filter or slice
function roomOf(user) {
  for (const room of rooms) if (room.id === user.roomId) return room;
  fail(`room ${user.roomId} missing from .data.json`);
}

export function setup() {
  if (users.length < VUS)
    fail(`${VUS} VUs but only ${users.length} users: rerun load-seed.js`);
  if (new Date(data.expiresAt) < new Date(Date.now() + 3 * 60 * 1000)) {
    fail(
      "access tokens expire before the end of the test (3 min): rerun load-seed.js",
    );
  }
}

export default function () {
  // One user per VU: a user never races itself, so its final state is known
  const user = users[(__VU - 1) % users.length];
  const room = roomOf(user);

  if (__ITER === 0) {
    for (const itemId of room.roomTrackIds) {
      const res = http.put(voteUrl(room.id, itemId), null, auth(user.token));
      votesSent.add(1);
      check(res, { "vote 204": (r) => r.status === 204 });
    }
    return;
  }

  const itemId =
    room.roomTrackIds[Math.floor(Math.random() * room.roomTrackIds.length)];
  const del = http.del(voteUrl(room.id, itemId), null, auth(user.token));
  check(del, { "unvote 204": (r) => r.status === 204 });
  const put = http.put(voteUrl(room.id, itemId), null, auth(user.token));
  votesSent.add(1);
  check(put, { "vote 204": (r) => r.status === 204 });
}

// Every VU ran at least once, so each item must count the users of its room among the first VUS
export function teardown() {
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    let expected = 0;
    for (let i = 0; i < VUS; i++) if (users[i].roomId === room.id) expected++;
    // The owners are the first users: users[r] owns rooms[r]
    const res = http.get(`${API_URL}/v1/rooms/${room.id}/tracks`, {
      headers: { Authorization: `Bearer ${users[r].token}` },
    });
    if (res.status !== 200) {
      voteMismatches.add(1);
      console.error(`room ${r}: GET tracks answered ${res.status}`);
      continue;
    }
    const body = res.json();
    const items = [...(body.playing ? [body.playing] : []), ...body.queue];
    for (const item of items) {
      if (item.votes !== expected) {
        voteMismatches.add(1);
        console.error(
          `room ${r}, item ${item.id}: ${item.votes} votes, expected ${expected}`,
        );
      }
    }
  }
}
