# The one command everything runs: `make verify`.
# Hooks call it, CI calls it, you call it — so local and CI never drift.

.DEFAULT_GOAL := help
.PHONY: help install verify fmt fmt-check lint typecheck check-js check-public sync-public test cov ui project-ui

FRONTEND := table_deps/frontend_service

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'

install: ## Install runtime + dev dependencies
	uv sync --extra dev

verify: fmt-check lint typecheck check-js check-public test ## Full quality suite (the source of truth)
	@echo "✓ verify passed"

fmt: ## Auto-format Python
	uv run ruff format .
	uv run ruff check --fix .

fmt-check: ## Fail if Python is not formatted
	uv run ruff format --check .

lint: ## Lint Python
	uv run ruff check .

typecheck: ## Static type checking
	uv run mypy table_deps

check-js: ## Syntax-check frontend JS
	@for f in $(FRONTEND)/static/js/*.js; do node --check "$$f" || exit 1; done
	@echo "  js syntax ok"

check-public: ## Fail if public/ (Vercel build) drifted from the frontend source
	@diff -r $(FRONTEND)/static public/static >/dev/null \
	  && diff $(FRONTEND)/templates/visualizer.html public/index.html >/dev/null \
	  && diff $(FRONTEND)/templates/project.html public/project.html >/dev/null \
	  && echo "  public/ in sync" \
	  || (echo "  public/ is out of sync with $(FRONTEND) — run 'make sync-public'" && exit 1)

sync-public: ## Copy frontend source into public/ (Vercel static build)
	rm -rf public/static && cp -R $(FRONTEND)/static public/static
	cp $(FRONTEND)/templates/visualizer.html public/index.html
	cp $(FRONTEND)/templates/project.html public/project.html

test: ## Run tests
	uv run pytest -q

cov: ## Run tests with coverage
	uv run pytest --cov=table_deps --cov-report=term-missing

ui: ## Launch the SQL visualizer locally
	uv run table-deps ui

project-ui: ## Launch the project DAG on the Kimball example
	uv run table-deps project-ui test_projects/kimball_retail
