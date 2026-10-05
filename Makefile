DC     := docker compose --project-directory . $(if $(wildcard .env),--env-file .env)
DEV    := $(DC) -f infra/compose.yml -f infra/compose.dev.yml
PROD   := $(DC) -f infra/compose.yml -f infra/compose.prod.yml

.DEFAULT_GOAL := help
.PHONY: help doctor install add dev stop logs ps test migrate shell db mobile \
        clean fclean re prod prod-down prod-logs prod-migrate

help: ## Command list
	@grep -hE '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-13s %s\n", $$1, $$2}'

.env:
	cp .env.example .env
	@echo ".env created from .env.example : please fill in the secrets."

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
	$(DEV) up -d --build -V api

dev: .env ## Launches db, mailpit and api (hot reload)
	$(DEV) up -d --build -V

stop: ## Stops the dev stack (keeps the data)
	$(DEV) down

logs: ## Aggregated logs of every service
	$(DEV) logs -f --tail=100

ps: ## Container states
	$(DEV) ps

test: ## Backend tests
	$(DEV) run --rm api npm test

migrate: ## DB migrations (dev)
	$(DEV) run --rm api npm run migrate

shell: ## Shell inside the api container
	$(DEV) exec api sh

db: ## MariaDB client
	$(DEV) exec db sh -c 'mariadb -u"$$MARIADB_USER" -p"$$MARIADB_PASSWORD" "$$MARIADB_DATABASE"'

mobile: ## Launches the flutter app (hot reload)
	cd mobile && flutter run

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

prod: .env ## Production stack
	$(PROD) up -d --build

prod-down: ## Stops the production stack
	$(PROD) down

prod-logs: ## Production logs
	$(PROD) logs -f --tail=100

prod-migrate: ## DB migrations (prod)
	$(PROD) run --rm api npm run migrate