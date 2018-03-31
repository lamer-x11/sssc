.PHONY: build
build:
	docker build -t sssc dockerfiles/

.PHONY: dev
dev:
	docker run -ti --rm -v $(CURDIR):/app sssc ash

