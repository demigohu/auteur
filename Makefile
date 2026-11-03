.PHONY: install dev web api test types

install:
	cd web && npm install
	cd api && uv sync
	cd motion && npm install

# Jalankan web (port 3000) dan api (port 8000) bersamaan; Ctrl+C menghentikan keduanya
dev:
	@trap 'kill 0' INT TERM; \
	$(MAKE) api & \
	$(MAKE) web & \
	wait

web:
	cd web && npm run dev

api:
	cd api && uv run uvicorn auteur.main:app --reload --port 8000

test:
	cd api && uv run pytest -q
	cd web && npm test
	cd motion && npm test

# Regenerate web/src/lib/timeline.ts from the Pydantic models
types:
	cd api && uv run python scripts/export_schema.py
	cd web && npm run -s types
