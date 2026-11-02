DC     := docker compose --project-directory . $(if $(wildcard .env),--env-file .env)
DEV    := $(DC) -f infra/compose.yml -f infra/compose.dev.yml
PROD   := $(DC) -f infra/compose.yml -f infra/compose.prod.yml

# Stack currently running, read from the compose label of the api container (dev when none).
# Recursive (=) so each recipe sees the state at the moment it runs.
RUNNING = $(shell docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' music-room-api 2>/dev/null)
IS_PROD = $(findstring compose.prod.yml,$(RUNNING))
STACK   = $(if $(IS_PROD),$(PROD),$(DEV))
DEV_ONLY = $(if $(IS_PROD),$(error the prod stack is running: make stop, then make dev))

# Load test: s= scenario file in load/ (without .js), vus = virtual users
s   ?= connect
vus ?= 50

.DEFAULT_GOAL := help
.PHONY: help doctor install add dev stop logs ps test lint format migrate seed shell db mobile load clean fclean re prod

help: ## Command list
	@echo "Usage: make <target>"
	@echo
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-13s %s\n", $$1, $$2}'
	@echo
	@echo "Dev, first run:"
	@echo "  1. make doctor     optional: checks docker, node 22, flutter"
	@echo "  2. make install    host deps for the IDE + flutter"
	@echo "  3. make .env       passwords generated, fill in the Google IDs if needed"
	@echo "  4. make dev        db, mailpit, api, then DB migrations"
	@echo "  5. make mobile     app on a USB Android phone, else in Chrome"
	@echo
	@echo "Dev, next runs:"
	@echo "  make dev, then make mobile    (make stop when done)"
	@echo "  make install                  after a package.json or pubspec.yaml change"
	@echo
	@echo "Production:"
	@echo "  1. make .env       strong secrets + the SMTP_* lines (no mailpit in prod)"
	@echo "  2. make stop       dev and prod share the same containers and DB volume"
	@echo "  3. make prod       builds and starts db + api on port 3000, then migrations"
	@echo "  make logs / make stop              follow / stop it (dev or prod, detected)"
	@echo "  make prod                          again after a git pull, to rebuild"

.env:
	cp .env.example .env
	for v in DB_PASSWORD DB_ROOT_PASSWORD JWT_SECRET; do \
		sed -i.bak "s/^$$v=.*/$$v=$$(openssl rand -hex 32)/" .env; \
	done
	sed -i.bak "s/^SEED_PASSWORD=.*/SEED_PASSWORD=$$(openssl rand -hex 6)/" .env && rm .env.bak
	@echo ".env created from .env.example with generated passwords."

doctor: ## Checks the requirements (docker, node 22, npm, flutter, make)
	@for c in docker node npm flutter make; do command -v $$c >/dev/null || { echo "missing: $$c"; exit 1; }; done
	@docker compose version >/dev/null || { echo "missing: docker compose"; exit 1; }
	@[ "$$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || { echo "node >= 22 required (same as the container)"; exit 1; }
	@echo "ok"

install: ## Host dependencies: backend (for the IDE) + flutter
	cd backend && npm install
	cd mobile && flutter pub get

add: ## Adds a backend package: make add p="fastify-plugin"
	cd backend && npm install $(p)
	$(STACK) up -d --build -V api

dev: .env ## Launches db, mailpit and api (hot reload), then DB migrations
	$(DEV) up -d --build -V
	$(DEV) exec api npm run migrate

stop: ## Stops the running stack, dev or prod (keeps the data)
	$(STACK) down

logs: ## Aggregated logs of every service
	$(STACK) logs -f --tail=100

ps: ## Container states
	$(STACK) ps

test: ## Backend tests (dev only)
	$(DEV_ONLY)$(DEV) run --rm api npm test

lint: ## Backend lint (dev only)
	$(DEV_ONLY)$(DEV) run --rm --no-deps api npm run lint

format: ## Formats the backend code (prettier + eslint --fix)
	cd backend && npm run format

migrate: ## DB migrations
	$(STACK) run --rm api npm run migrate

seed: ## Demo data: 4 users (password = SEED_PASSWORD in .env), 2 rooms
	$(STACK) exec api node src/db/seed.js

shell: ## Shell inside the api container
	$(STACK) exec api sh

db: ## MariaDB client
	$(STACK) exec db sh -c 'mariadb -u"$$MARIADB_USER" -p"$$MARIADB_PASSWORD" "$$MARIADB_DATABASE"'

# Public client ID read from .env (no secret), passed to Flutter at build time
GOOGLE_CLIENT_ID_WEB = $(shell sed -n 's/^GOOGLE_CLIENT_ID_WEB=//p' .env 2>/dev/null)

mobile: ## Launches the flutter app (hot reload)
	@# The phone (or emulator) reaches the api on its own localhost:3000; ignored without adb
	-@adb reverse tcp:3000 tcp:3000 >/dev/null 2>&1
	@# Fixed web port: Google only accepts the origins declared in the OAuth client
	cd mobile && flutter run --web-port 5000 --dart-define=GOOGLE_CLIENT_ID_WEB=$(GOOGLE_CLIENT_ID_WEB)

load: ## Load test against the prod stack: make load s=connect vus=200
	$(if $(IS_PROD),,$(error the load test needs the prod stack: make stop, then make prod))
	@test -f load/$(s).js || { echo "no scenario load/$(s).js"; exit 1; }
	@# -T: no TTY, so stdout carries the JSON only
	$(PROD) exec -T -e LOAD_USERS=$(vus) api node src/db/load-seed.js > load/.data.json
	docker run --rm --network music-room-net -v "$(CURDIR)/load:/load:ro" -w /load \
	-e VUS=$(vus) grafana/k6:2.3.0 run $(s).js



clean: ## Soft clean: removes containers, keeps DB and images
	$(DEV) down --remove-orphans
	$(PROD) down --remove-orphans
	-cd mobile && flutter clean

fclean: ## TOTAL RESET: containers, volumes (DB), images, caches, node_modules (asks confirmation)
	@printf "Deletes containers, volumes (DB data), images, caches and node_modules. Continue ? [y/N] " && read ans && [ "$$ans" = "y" ]
	$(DEV) down -v --rmi local --remove-orphans
	$(PROD) down -v --rmi local --remove-orphans
	-cd mobile && flutter clean
	rm -rf backend/node_modules

re: fclean install dev ## Total reset then restart

prod: .env ## Production stack, then DB migrations
	$(PROD) up -d --build
	$(PROD) exec api npm run migrate
