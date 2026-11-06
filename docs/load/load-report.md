# Load report

How many users the API holds at once, on the school PC used for the defense.

## Server

Measured on: 06/11/2026, school PC z1r3p2.

|        |                                                                                         |
|--------|-----------------------------------------------------------------------------------------|
| CPU    | Intel Core i7-14700, 20 cores (8 performance + 12 efficient), 28 threads, up to 5.4 GHz |
| RAM    | 15 GiB (about 9 GiB available before the test), 4 GiB swap                              |
| Disk   | 18 GB home partition, 6.8 GB free                                                       |
| OS     | Ubuntu 22.04.5 LTS, kernel 6.8.0-138-generic                                            |
| Docker | 29.7.2, no CPU or memory limit on the containers                                        |

The API, MariaDB, Redis and k6 all run on this one machine (`make prod`, then `make load`), so k6 takes part of the CPU:
the real limit is a little higher than measured.

## Method

- `make load s=<scenario> vus=<n>`: `load-seed.js` creates `n` users, 10 public rooms with 5 tracks each and access
  tokens, then k6 runs the scenario.
- Ramp up 30 s, hold 1 min, ramp down 10 s.
- A step passes if p95 < 500 ms and errors < 1 %, the limits from Technical Requirements. We raise `vus` until a step
  fails.

### Scenarios

- `connect`: each user opens a Socket.IO connection, subscribes to its room and stays connected. Measures how many
  listeners the server holds.
- `vote`: each user votes for every track of its room, then removes and puts back one vote, without pause. At the end,
  each track must count exactly one vote per user of its room (`vote_mismatches` = 0): no vote lost, none doubled.

## Results

### connect

| VUs  | connect p95 | ack p95 | errors | verdict                              |
|------|-------------|---------|--------|--------------------------------------|
| 400  | 2 ms        | 2 ms    | 0.00%  | ok                                   |
| 800  | 2 ms        | 2 ms    | 0.00%  | ok                                   |
| 1600 | 2 ms        | 3 ms    | 0.00%  | ok                                   |
| 5000 | -           | -       | -      | k6 killed (out of memory, error 137) |

### vote

| VUs  | vote p95  | errors | votes sent | vote_mismatches | verdict          |
|------|-----------|--------|------------|-----------------|------------------|
| 50   | 16.45 ms  | 0.00%  | 187695     | 0               | ok               |
| 100  | 33.85 ms  | 0.00%  | 185656     | 0               | ok               |
| 200  | 60.02 ms  | 0.00%  | 192040     | 0               | ok               |
| 400  | 128 ms    | 0.00%  | 182426     | 0               | ok               |
| 800  | 238.96 ms | 0.00%  | 188818     | 0               | ok               |
| 1600 | 485.05 ms | 0.00%  | 187030     | 0               | ok               |
| 1800 | 592.85 ms | 0.00%  | 179616     | 0               | fail (p95>500ms) |

## Final figure

The API holds **1600 users voting at the same time** with p95 < 500 ms and zero errors.

The API also holds **at least 1600 users connected at the same time** with p95 = 2ms and zero errors. The limit was not
reached, k6 ran out of memory first.

## Bottleneck

### Vote scenario

The API process is the bottleneck: ~135 % CPU in `docker stats` at every step (Node runs our code on one thread), while
MariaDB and Redis stay low and memory stays under 20 %. Throughput is flat, ~1,870 votes/s (~3,750 requests/s) from 50
to 1800 VUs: the API is saturated from 50 VUs on, extra users only wait in line, so p95 grows with the VU count. Even
past the limit (1800 VUs) `vote_mismatches` stays 0: no vote is lost or doubled under saturation. Next step to go
further: several API instances (Node cluster or containers behind a proxy). State lives in MariaDB and Redis and
Socket.IO uses the Redis adapter, so nothing blocks it.

### Connect Scenario

The connect scenario is way less demanding on the CPU/memory usage of the containers. We couldn't find a p95<500ms limit
on the API or DB containers, because k6 was running out of RAM and CPU first.

## Limits of this test

- One machine for everything: no network latency between the phone and the server.
- Users never log in during the test (argon2 would dominate the measure); login is limited by its rate limit anyway.
- No scenario measures the `room.changed` fan-out under load: `vote` opens no socket, and `connect` listeners receive no
  event.
- VUs vote without pause: 1600 VUs send ~3,750 requests/s. A real user votes every few seconds, so 1600 VUs stand for
  far more than 1600 people.
- Control Delegation is not load tested: few actors per room, commands limited to 120/min per user, concurrent skips
  covered by integration tests.
