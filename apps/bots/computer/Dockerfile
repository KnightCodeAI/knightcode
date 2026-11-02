# The user's computer (spec section 7): Ubuntu with the knightcode-env daemon (built here from packages/env/daemon),
# Xvfb, a window manager, Chrome, VNC, git, gh, Node, Python with uv, and document tools. The build context is the
# repository root (wrangler's image_build_context); Dockerfile.dockerignore keeps it to the files used below.

# ─── knightcode-env for Linux, and the connect() guard ──────────────────────────
FROM rust:1.96.0-bookworm@sha256:5e2214abe154fe26e39f64488952e5c991eeed1d6d6da7cc8381ae83927f0cfc AS build
ENV CARGO_BUILD_JOBS=4
WORKDIR /src/env
# build.rs reads the version from ../package.json.
COPY packages/env/package.json ./package.json
COPY packages/env/daemon ./daemon
RUN cd daemon && cargo build --release --locked
COPY apps/bots/computer/netguard/netguard.c /src/netguard.c
RUN gcc -shared -fPIC -O2 -Wall -o /src/libnetguard.so /src/netguard.c -ldl -lpthread

# ─── The computer ────────────────────────────────────────────────────────────────
FROM ubuntu:24.04@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8
RUN apt-get update && apt-get install -y --no-install-recommends \
		ca-certificates curl gnupg unzip xz-utils tar procps psmisc sudo locales tzdata \
		xvfb xauth openbox x11vnc xdotool imagemagick novnc \
		fonts-dejavu fonts-liberation fonts-noto-color-emoji \
		git python3 python3-venv nodejs npm poppler-utils pandoc \
	&& rm -rf /var/lib/apt/lists/*
# Chrome (Ubuntu ships Chromium only as a snap, which does not run in a container).
RUN curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google.gpg \
	&& echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
		> /etc/apt/sources.list.d/google-chrome.list \
	&& curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli.gpg \
	&& echo "deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" \
		> /etc/apt/sources.list.d/github-cli.list \
	&& apt-get update && apt-get install -y --no-install-recommends google-chrome-stable gh \
	&& rm -rf /var/lib/apt/lists/*
# uv and Bun (the bridge's runtime), pinned.
RUN curl -fsSL https://github.com/astral-sh/uv/releases/download/0.8.22/uv-x86_64-unknown-linux-gnu.tar.gz \
		| tar -xz -C /usr/local/bin --strip-components=1 \
	&& curl -fsSL -o /tmp/bun.zip https://github.com/oven-sh/bun/releases/download/bun-v1.3.3/bun-linux-x64-baseline.zip \
	&& unzip -q /tmp/bun.zip -d /tmp && mv /tmp/bun-linux-x64-baseline/bun /usr/local/bin/bun && rm -rf /tmp/bun*

COPY --from=build /src/env/daemon/target/release/knightcode-env /usr/local/bin/knightcode-env
COPY --from=build /src/libnetguard.so /usr/local/lib/libnetguard.so
RUN echo /usr/local/lib/libnetguard.so > /etc/ld.so.preload \
	&& groupadd botshare && mkdir -p /home/shared /var/lib/kb && chgrp botshare /home/shared && chmod 2775 /home/shared

# The bridge keeps the repository's relative layout, so it imports the abuse rules from the Worker's source.
COPY apps/bots/src/computer/abuse.ts /opt/src/computer/abuse.ts
COPY apps/bots/computer/bridge /opt/computer/bridge
COPY apps/bots/computer/desktop /opt/computer/desktop
COPY apps/bots/computer/setup.sh /opt/computer/setup.sh
RUN sed -i 's/\r$//' /opt/computer/setup.sh /opt/computer/desktop/session.sh \
	&& chmod 755 /opt/computer/setup.sh /opt/computer/desktop/session.sh

EXPOSE 8080
CMD ["bun", "/opt/computer/bridge/server.ts"]
