# Run KnightCode in an isolated environment

Use an isolated environment to limit the files, credentials, processes, and network services that generated commands can access or affect.

You can isolate the complete KnightCode process or keep KnightCode on the host and route selected tools into an isolated environment.

## Choose an isolation method

| Method | Where KnightCode runs | What is isolated | Credential handling | Best for |
|---|---|---|---|---|
| Plain Docker | Container | KnightCode, built-in tools, `!` commands, and extensions | Credentials passed into the container | A straightforward local container boundary |
| OpenShell | Local or remote sandbox | KnightCode, built-in tools, `!` commands, and extensions | Policy-controlled credentials and inference routing | Filesystem, process, network, and credential policies |
| Gondolin extension | Host | Built-in tools and `!` commands | Stored KnightCode credentials remain on the host, but commands inherit host environment variables | A local micro-VM for tool execution while retaining the host interface |

The method changes where extensions run. When the complete KnightCode process runs inside an isolated environment, its extensions run there too. When host KnightCode delegates built-in tools through Gondolin, other extension tools still run on the host unless they also delegate their work.

## Decide what KnightCode can access

An isolated process can still affect resources you expose to it:

- A read-write host mount lets KnightCode modify those host files.
- Mounting `~/.knightcode/agent` exposes your KnightCode credentials, settings, extensions, and sessions.
- Environment variables passed into a container are available to processes inside it.
- Network access may allow code or tool output to leave the environment.
- Tool-only isolation does not constrain the host KnightCode process or extension tools that do not use the isolated backend.

Expose only the working folder, credentials, and network destinations needed for the task. Use read-only mounts or copy files into and out of the environment when you do not want writes to affect the host.

## Run KnightCode in plain Docker

Plain Docker provides the simplest whole-process container boundary.

### Build the image

Create `Dockerfile.knightcode`:

```dockerfile
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @knightcodeai/cli

WORKDIR /workspace
ENTRYPOINT ["knightcode"]
```

Build it from the directory containing the file:

```bash
docker build -t knightcode-sandbox -f Dockerfile.knightcode .
```

### Start KnightCode

From the working folder you want KnightCode to access, run:

```bash
docker run --rm -it \
  -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" \
  -v knightcode-agent-home:/root/.knightcode/agent \
  knightcode-sandbox
```

Replace `ANTHROPIC_API_KEY` with the credential required by your provider. The named `knightcode-agent-home` volume keeps container-local settings, credentials, and sessions between runs.

Do not mount the host's `~/.knightcode/agent` unless the container should have access to your host KnightCode configuration and credentials.

### Verify the workspace

Inside KnightCode, run:

```text
!pwd
```

The command should report `/workspace`. Changes under `/workspace` write through to the mounted host folder. Remove the bind mount or use a read-only mount when that is not acceptable.

## Run KnightCode with OpenShell

[NVIDIA OpenShell](https://docs.nvidia.com/openshell/about/overview) provides local or remote sandboxes with filesystem, process, network, credential, and inference policies.

### Select a gateway

Every sandbox requires an active gateway:

```bash
openshell gateway add <gateway-url> --name <name>
openshell gateway select <name>
```

### Create the sandbox

```bash
openshell sandbox create --name knightcode-sandbox --from knightcode -- knightcode
```

KnightCode, its built-in tools, `!` commands, and extension tools run inside the OpenShell boundary.

### Transfer files to a remote sandbox

A remote gateway does not bind-mount your host working folder. Clone the repository inside the sandbox or transfer files explicitly:

```bash
openshell sandbox upload knightcode-sandbox ./working-folder /workspace
openshell sandbox download knightcode-sandbox /workspace/working-folder ./working-folder-out
```

OpenShell inference routing can keep raw model credentials outside the sandbox. When configured, point KnightCode at the corresponding OpenAI-compatible or Anthropic-compatible endpoint exposed by the gateway.

## Route tools through Gondolin

[Gondolin](https://github.com/KnightCodeAI/gondolin) is a local Linux micro-VM. Its example extension keeps the KnightCode process and file-based provider credentials on the host while routing the built-in tools and user `!` commands into the VM.

Commands inside the VM inherit the host process environment. Provider keys supplied through environment variables can therefore be visible inside the VM. Do not use this pattern as a credential boundary unless you remove sensitive variables or change the extension's environment handling.

Gondolin requires Node.js 23.6 or newer and QEMU installed through your operating-system package manager.

### Install the extension

From a KnightCode source checkout:

```bash
mkdir -p ~/.knightcode/agent/extensions
cp -R packages/cli/examples/extensions/gondolin ~/.knightcode/agent/extensions/gondolin
cd ~/.knightcode/agent/extensions/gondolin
npm install --ignore-scripts
```

### Start KnightCode

Run KnightCode from the working folder you want mounted:

```bash
cd /path/to/working-folder
knightcode -e ~/.knightcode/agent/extensions/gondolin
```

The extension mounts the host working folder at `/workspace` in the VM and overrides `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls`. File changes under `/workspace` write through to the host.

Other extension tools still run on the host unless they explicitly delegate their operations. Review the [Gondolin example](../examples/extensions/gondolin/) before adding tools that could bypass the VM boundary.
