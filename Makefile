SERVER_URL ?= https://watch.ruszabarov.com
VERSION_BUMP ?= patch
EXTENSION_FILTER := @open-watch-party/extension

.PHONY: extension-version extension-safari safari

safari: extension-safari

extension-version:
	npm --prefix apps/extension version $(VERSION_BUMP) --no-git-tag-version

extension-safari: extension-version
	SERVER_URL=$(SERVER_URL) pnpm --filter $(EXTENSION_FILTER) exec wxt zip -b safari
