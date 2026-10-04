#!/bin/sh
# Installs KnightCode on macOS and Linux. Run it again to reinstall or uninstall.

KNIGHTCODE_PACKAGE="@knightcodeai/cli"
KNIGHTCODE_CMD="knightcode"
KNIGHTCODE_INSTALLER_API_BASE="${KNIGHTCODE_INSTALLER_API_BASE:-https://knightcode.dev/api/installer/releases}"
KNIGHTCODE_MANAGED_INSTALL_MARKER="managed-install.json"
# Overrides a user npmrc min-release-age so a release can install immediately.
# npm ignores the flag until the version that implements it.
KNIGHTCODE_NPM_INSTALL_MIN_AGE_ARG="--min-release-age=0"
KNIGHTCODE_ESC=$(printf '\033')
KNIGHTCODE_CR=$(printf '\r')
KNIGHTCODE_ETX=$(printf '\003')
readonly KNIGHTCODE_PACKAGE KNIGHTCODE_CMD KNIGHTCODE_INSTALLER_API_BASE KNIGHTCODE_MANAGED_INSTALL_MARKER KNIGHTCODE_NPM_INSTALL_MIN_AGE_ARG KNIGHTCODE_ESC KNIGHTCODE_CR KNIGHTCODE_ETX

knightcode_installer_main() {
  set -eu

  check_file="${TMPDIR:-/tmp}/knightcode-installer-checks.$$"
  run_preflight_checks >"$check_file" &
  check_pid=$!

  if wait "$check_pid"; then
    check_status=0
  else
    check_status=$?
  fi

  printf '\033[1m  KnightCode installer\033[0m\n\n'
  if [ "$check_status" -eq 0 ]; then
    cat "$check_file"
  fi
  rm -f "$check_file"

  if [ "$check_status" -ne 0 ]; then
    if ! install_node_npm_interactive; then
      exit "$check_status"
    fi

    check_file="${TMPDIR:-/tmp}/knightcode-installer-checks.$$"
    if run_preflight_checks >"$check_file"; then
      check_status=0
    else
      check_status=$?
    fi
    cat "$check_file"
    rm -f "$check_file"

    if [ "$check_status" -ne 0 ]; then
      exit "$check_status"
    fi
  fi

  KNIGHTCODE_EXISTING_PATH=$(command -v "$KNIGHTCODE_CMD" 2>/dev/null || true)
  export KNIGHTCODE_EXISTING_PATH

  if knightcode_managed_install_enabled; then
    if ! ensure_managed_install_supported; then
      exit 1
    fi
    KNIGHTCODE_MANAGED_INSTALL_DIR=$(select_managed_install_dir "$KNIGHTCODE_EXISTING_PATH")
    KNIGHTCODE_MANAGED_AGENT_DIR=${KNIGHTCODE_MANAGED_INSTALL_DIR%/*}
    KNIGHTCODE_MANAGED_BIN_DIR=$(select_managed_path_bin_dir "$KNIGHTCODE_MANAGED_AGENT_DIR" "$KNIGHTCODE_MANAGED_INSTALL_DIR" "$KNIGHTCODE_EXISTING_PATH")
    KNIGHTCODE_NPM_INSTALL_PREFIX=
    export KNIGHTCODE_MANAGED_INSTALL_DIR KNIGHTCODE_MANAGED_AGENT_DIR KNIGHTCODE_MANAGED_BIN_DIR
  else
    if ! KNIGHTCODE_NPM_INSTALL_PREFIX=$(select_npm_install_prefix); then
      exit 1
    fi
  fi
  export KNIGHTCODE_NPM_INSTALL_PREFIX

  KNIGHTCODE_LEGACY_NPM_MIGRATION=0
  if knightcode_managed_install_enabled && managed_install_root_for_command "$KNIGHTCODE_EXISTING_PATH" >/dev/null 2>&1; then
    KNIGHTCODE_NPM_UNINSTALL_PREFIX=
  else
    KNIGHTCODE_NPM_UNINSTALL_PREFIX=$(select_npm_uninstall_prefix "$KNIGHTCODE_EXISTING_PATH")
    if knightcode_managed_install_enabled && [ -n "$KNIGHTCODE_EXISTING_PATH" ] && npm_package_is_installed_for_uninstall; then
      KNIGHTCODE_LEGACY_NPM_MIGRATION=1
    fi
  fi
  export KNIGHTCODE_NPM_UNINSTALL_PREFIX KNIGHTCODE_LEGACY_NPM_MIGRATION

  choose_knightcode_action "$KNIGHTCODE_EXISTING_PATH"
  case "$KNIGHTCODE_INSTALL_ACTION" in
    uninstall)
      uninstall_knightcode_package
      printf '\nKnightCode was uninstalled successfully.\n'
      exit 0
      ;;
    none)
      exit 0
      ;;
    migrate)
      if ! ensure_legacy_npm_knightcode_removable; then
        exit 1
      fi
      ;;
  esac

  install_knightcode_package
  if [ "$KNIGHTCODE_INSTALL_ACTION" = migrate ]; then
    printf '\nKnightCode was migrated to a managed installation successfully.\n'
  elif [ "$KNIGHTCODE_INSTALL_ACTION" = reinstall ]; then
    printf '\nKnightCode was reinstalled successfully.\n'
  else
    printf '\nKnightCode was installed successfully.\n'
  fi
  if knightcode_managed_install_enabled; then
    printf '\nUpdate KnightCode later with: knightcode update\n'
  fi
  if installed_knightcode_is_first_on_path; then
    printf '\nRun it with: knightcode\n'
    if ! knightcode_managed_install_enabled && [ "${KNIGHTCODE_NODE_INSTALLED_STANDALONE:-0}" = 1 ]; then
      printf 'If node is not found in your shell yet, add this to your shell profile:\n\n'
      printf '  export PATH="%s:$PATH"\n' "$KNIGHTCODE_STANDALONE_NODE_BIN"
    fi
  else
    print_knightcode_not_on_path_message
  fi

  prompt_start_knightcode
}

# The installer runs as a child process and cannot change the calling shell's
# PATH, so offer to start the installed knightcode by its full path. This makes the
# first run work even when the shell still needs a restart to find knightcode.
prompt_start_knightcode() {
  start_knightcode_path=$(knightcode_installed_path)
  [ -n "$start_knightcode_path" ] && [ -x "$start_knightcode_path" ] || return 0
  [ -t 1 ] || return 0
  if ! ( : <>/dev/tty ) 2>/dev/null; then
    return 0
  fi

  exec 3<>/dev/tty
  printf '\nStart knightcode now? [Y/n] ' >&3
  if ! IFS= read -r answer <&3; then
    answer=n
  fi
  exec 3>&-
  case "$answer" in
    n|N|no|NO) return 0 ;;
  esac

  printf '\n'
  unset KNIGHTCODE_EXISTING_PATH KNIGHTCODE_MANAGED_INSTALL_DIR KNIGHTCODE_MANAGED_AGENT_DIR KNIGHTCODE_MANAGED_BIN_DIR KNIGHTCODE_NPM_INSTALL_PREFIX KNIGHTCODE_NPM_UNINSTALL_PREFIX KNIGHTCODE_LEGACY_NPM_MIGRATION
  exec "$start_knightcode_path" </dev/tty
}

run_preflight_checks() {
  status=0

  if command -v node >/dev/null 2>&1; then
    node_version=$(node --version)
    if ! node -e 'const [maj] = process.versions.node.split(".").map(Number); process.exit(maj >= 22 ? 0 : 1)' >/dev/null; then
      printf 'error: KnightCode requires Node.js 22 or newer. Found %s.\n' "$node_version"
      status=1
    fi
  else
    printf 'error: Node.js 22 or newer is required to install KnightCode.\n'
    status=1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    printf 'error: npm is required to install KnightCode.\n'
    status=1
  fi

  if [ "$status" -ne 0 ]; then
    printf '\n'
  fi

  return "$status"
}

install_node_npm_interactive() {
  method=$(detect_node_install_method)
  case "$method" in
    homebrew) label="Homebrew" ;;
    apt) label="apt" ;;
    apk) label="apk" ;;
    standalone) label="standalone Node.js" ;;
  esac

  if ! ( : <>/dev/tty ) 2>/dev/null; then
    printf 'No terminal detected; install Node.js 22 or newer and npm, then run this installer again.\n'
    return 1
  fi
  exec 3<>/dev/tty

  printf 'KnightCode needs Node.js 22 or newer and npm. Install them now with %s? [Y/n] ' "$label" >&3
  if ! IFS= read -r answer <&3; then
    answer=
  fi
  exec 3>&-
  case "$answer" in
    n|N|no|NO) printf '\nInstall Node.js 22 or newer and npm, then run this installer again.\n'; return 1 ;;
    *) ;;
  esac

  install_node_npm "$method" "$label"
}

detect_node_install_method() {
  case "$(uname -s)" in
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        printf 'homebrew'
      else
        printf 'standalone'
      fi
      ;;
    Linux)
      if command -v apt-cache >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1 && apt_node_candidate_is_new_enough; then
        printf 'apt'
      elif command -v apk >/dev/null 2>&1 && apk_node_candidate_is_new_enough; then
        printf 'apk'
      else
        printf 'standalone'
      fi
      ;;
    *)
      printf 'standalone'
      ;;
  esac
}

apt_node_candidate_is_new_enough() {
  version=$(apt-cache policy nodejs 2>/dev/null | awk '/Candidate:/ { print $2; exit }')
  [ -n "$version" ] && [ "$version" != "(none)" ] && node_version_string_is_new_enough "$version"
}

apk_node_candidate_is_new_enough() {
  version=$(apk search -x nodejs 2>/dev/null | awk -F- '/^nodejs-/ { print $2; exit }')
  [ -n "$version" ] && node_version_string_is_new_enough "$version"
}

node_version_string_is_new_enough() {
  version="${1#v}"
  case "$version" in
    [0-9]*) ;;
    *) return 1 ;;
  esac
  version="${version%%[!0-9.]*}"
  version_ifs=${IFS- }
  IFS=.
  set -- $version
  IFS=$version_ifs
  major="${1:-}"
  case "$major" in ''|*[!0-9]*) return 1 ;; esac

  [ "$major" -ge 22 ]
}

install_node_npm() {
  method="$1"; label="$2"

  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    install_node_npm_with_progress "$method" "$label" || return
  else
    printf '\nInstalling Node.js and npm with %s...\n\n' "$label"
    if ! run_node_install_method "$method"; then
      printf '\nNode.js installation failed.\n'
      return 1
    fi
    printf '\nNode.js and npm are installed.\n'
  fi

  if [ "$method" = standalone ]; then
    load_standalone_node
    KNIGHTCODE_NODE_INSTALLED_STANDALONE=1
  fi
  hash -r
  printf '\n'
}

install_node_npm_with_progress() {
  method="$1"; label="$2"
  log_file="${TMPDIR:-/tmp}/knightcode-installer-node.$$"
  rm -f "$log_file"
  : >"$log_file"

  run_node_install_method "$method" >"$log_file" 2>&1 &
  install_pid=$!

  printf '\033[?25l'
  animate_node_install "$log_file" "$label" &
  progress_pid=$!
  trap 'kill "$install_pid" 2>/dev/null || true; finish_install_progress "$progress_pid"; exit 130' INT TERM

  if wait "$install_pid"; then
    status=0
  else
    status=$?
  fi

  finish_install_progress "$progress_pid"
  trap - INT TERM

  if [ "$status" -ne 0 ]; then
    printf '\033[31mNode.js installation failed.\033[0m\n\n'
    cat "$log_file"
    rm -f "$log_file"
    return "$status"
  fi

  rm -f "$log_file"
  if terminal_supports_unicode; then
    printf '  \033[32m✓\033[0m Node.js and npm install complete\n'
  else
    printf '  \033[32mok\033[0m Node.js and npm install complete\n'
  fi
}

run_node_install_method() {
  case "$1" in
    homebrew) install_node_with_homebrew ;;
    apt) install_node_with_apt ;;
    apk) install_node_with_apk ;;
    standalone) install_node_standalone ;;
  esac
}

install_node_with_homebrew() {
  if brew list node >/dev/null 2>&1; then
    brew upgrade node
  else
    brew install node
  fi
}

install_node_with_apt() {
  print_sudo_note
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    apt-get update
    apt-get install -y nodejs npm
  else
    sudo sh -c 'apt-get update && apt-get install -y nodejs npm'
  fi
}

install_node_with_apk() {
  print_sudo_note
  run_with_sudo apk add --update-cache nodejs npm
}

install_node_standalone() {
  node_platform=$(detect_node_binary_platform) || {
    printf 'Unsupported operating system for automatic Node.js install: %s\n' "$(uname -s)"
    return 1
  }
  node_arch=$(detect_node_binary_arch) || {
    printf 'Unsupported CPU architecture for automatic Node.js install: %s\n' "$(uname -m)"
    return 1
  }
  node_dist_base="https://nodejs.org/dist/latest-v22.x"
  node_base_dir=$(node_standalone_base_dir)
  node_tmp_dir="${TMPDIR:-/tmp}/knightcode-node.$$"

  rm -rf "$node_tmp_dir"
  mkdir -p "$node_tmp_dir" "$node_base_dir" || return 1

  printf 'Resolving Node.js binary for %s-%s\n' "$node_platform" "$node_arch"
  curl -fsSL "$node_dist_base/SHASUMS256.txt" -o "$node_tmp_dir/SHASUMS256.txt" || return 1
  node_file=$(awk -v suffix="-$node_platform-$node_arch.tar.xz" '
    index($2, "node-v") == 1 && length($2) >= length(suffix) && substr($2, length($2) - length(suffix) + 1) == suffix { print $2; exit }
  ' "$node_tmp_dir/SHASUMS256.txt")
  if [ -z "$node_file" ]; then
    printf 'No Node.js binary is available for %s-%s.\n' "$node_platform" "$node_arch"
    rm -rf "$node_tmp_dir"
    return 1
  fi

  printf 'Downloading Node.js %s\n' "${node_file%.tar.xz}"
  curl -fsSL "$node_dist_base/$node_file" -o "$node_tmp_dir/$node_file" || return 1
  if ! verify_node_standalone_download "$node_tmp_dir" "$node_file"; then
    printf 'Node.js download failed checksum verification.\n'
    rm -rf "$node_tmp_dir"
    return 1
  fi
  ensure_node_standalone_extract_tools "$node_platform" || return 1

  node_dir="$node_base_dir/${node_file%.tar.xz}"
  rm -rf "$node_dir"
  printf 'Extracting Node.js to %s\n' "$node_dir"
  tar -xf "$node_tmp_dir/$node_file" -C "$node_base_dir" || return 1
  rm -f "$node_base_dir/current"
  ln -s "$node_dir" "$node_base_dir/current" || return 1
  rm -rf "$node_tmp_dir"
  printf 'Node.js installed at %s\n' "$node_dir"
}

verify_node_standalone_download() {
  checksum_dir="$1"
  checksum_file_name="$2"
  awk -v file="$checksum_file_name" '$2 == file { print }' "$checksum_dir/SHASUMS256.txt" > "$checksum_dir/SHASUMS256.selected"

  if command -v sha256sum >/dev/null 2>&1; then
    printf 'Verifying Node.js download\n'
    (cd "$checksum_dir" && sha256sum -c SHASUMS256.selected)
  elif command -v shasum >/dev/null 2>&1; then
    printf 'Verifying Node.js download\n'
    (cd "$checksum_dir" && shasum -a 256 -c SHASUMS256.selected)
  else
    printf 'sha256sum or shasum is required to verify the Node.js download.\n'
    return 1
  fi
}

ensure_node_standalone_extract_tools() {
  extract_platform="$1"

  if [ "$extract_platform" = linux ] && ! command -v xz >/dev/null 2>&1; then
    printf 'Installing xz-utils for Node.js archive extraction\n'
    print_sudo_note
    if command -v apt-get >/dev/null 2>&1; then
      run_with_sudo apt-get update
      run_with_sudo apt-get install -y xz-utils
    elif command -v apk >/dev/null 2>&1; then
      run_with_sudo apk add --update-cache xz
    else
      printf 'xz is required to extract Node.js. Install xz and run this installer again.\n'
      return 1
    fi
  fi
}

load_standalone_node() {
  KNIGHTCODE_STANDALONE_NODE_BIN="$(node_standalone_base_dir)/current/bin"
  PATH="$KNIGHTCODE_STANDALONE_NODE_BIN:$PATH"
  export KNIGHTCODE_STANDALONE_NODE_BIN PATH
}

node_standalone_base_dir() {
  if [ -n "${XDG_DATA_HOME:-}" ]; then
    printf '%s/knightcode-node' "$XDG_DATA_HOME"
  else
    printf '%s/.local/share/knightcode-node' "$HOME"
  fi
}

detect_node_binary_platform() {
  case "$(uname -s)" in
    Darwin) printf 'darwin' ;;
    Linux) printf 'linux' ;;
    *) return 1 ;;
  esac
}

detect_node_binary_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    arm64|aarch64) printf 'arm64' ;;
    armv7l) printf 'armv7l' ;;
    ppc64le) printf 'ppc64le' ;;
    s390x) printf 's390x' ;;
    *) return 1 ;;
  esac
}

print_sudo_note() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    printf 'This may ask for your sudo password.\n\n'
  fi
}

run_with_sudo() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

select_npm_install_prefix() {
  npm_prefix=$(npm_global_prefix)
  if [ -n "$npm_prefix" ] && npm_prefix_supports_global_install "$npm_prefix"; then
    return 0
  fi

  if existing_global_knightcode_blocks_user_local_install "$npm_prefix"; then
    print_existing_global_knightcode_not_writable_message "$npm_prefix"
    return 1
  fi

  printf '%s/.local' "$HOME"
}

select_npm_uninstall_prefix() {
  existing_knightcode_path="$1"
  [ -n "$existing_knightcode_path" ] || return 0

  npm_prefix=$(npm_global_prefix)
  if [ -n "$npm_prefix" ] && [ "$existing_knightcode_path" = "$npm_prefix/bin/$KNIGHTCODE_CMD" ]; then
    return 0
  fi

  if [ -n "${KNIGHTCODE_NPM_INSTALL_PREFIX:-}" ] && [ "$existing_knightcode_path" = "$KNIGHTCODE_NPM_INSTALL_PREFIX/bin/$KNIGHTCODE_CMD" ]; then
    printf '%s' "$KNIGHTCODE_NPM_INSTALL_PREFIX"
    return 0
  fi

  knightcode_bin_suffix="/bin/$KNIGHTCODE_CMD"
  case "$existing_knightcode_path" in
    *"$knightcode_bin_suffix") printf '%s' "${existing_knightcode_path%$knightcode_bin_suffix}" ;;
  esac
}

npm_global_prefix() {
  npm prefix -g 2>/dev/null || npm config get prefix 2>/dev/null
}

npm_prefix_supports_global_install() {
  prefix="$1"
  path_is_writable_or_creatable "$prefix/lib/node_modules" && path_is_writable_or_creatable "$prefix/bin"
}

existing_global_knightcode_blocks_user_local_install() {
  npm_prefix="$1"
  [ -n "$npm_prefix" ] || return 1

  [ -e "$npm_prefix/bin/$KNIGHTCODE_CMD" ]
}

print_existing_global_knightcode_not_writable_message() {
  npm_prefix="$1"
  existing_knightcode_path="$npm_prefix/bin/$KNIGHTCODE_CMD"

  printf "npm's global directory is not writable: %s\n" "$npm_prefix" >&2
  printf 'KnightCode is already installed at: %s\n\n' "$existing_knightcode_path" >&2
  printf 'Installing another copy under %s/.local could leave your shell using the old global knightcode, so this installer stopped.\n\n' "$HOME" >&2
  printf 'Update or remove the existing global install first. If it was installed with npm, you can run:\n\n' >&2
  printf '  sudo npm install -g --ignore-scripts %s %s\n\n' "$KNIGHTCODE_NPM_INSTALL_MIN_AGE_ARG" "$KNIGHTCODE_PACKAGE" >&2
  printf 'or uninstall it first with:\n\n' >&2
  printf '  sudo npm uninstall -g %s\n\n' "$KNIGHTCODE_PACKAGE" >&2
  printf 'Then run this installer again.\n' >&2
}

path_is_writable_or_creatable() {
  check_path="$1"
  while [ ! -e "$check_path" ]; do
    parent=${check_path%/*}
    if [ -z "$parent" ] || [ "$parent" = "$check_path" ]; then
      return 1
    fi
    check_path="$parent"
  done

  [ -d "$check_path" ] && [ -w "$check_path" ]
}

knightcode_install_bin_dir() {
  if knightcode_managed_install_enabled; then
    printf '%s' "$KNIGHTCODE_MANAGED_BIN_DIR"
  elif [ -n "${KNIGHTCODE_NPM_INSTALL_PREFIX:-}" ]; then
    printf '%s/bin' "$KNIGHTCODE_NPM_INSTALL_PREFIX"
  else
    npm_prefix=$(npm_global_prefix)
    if [ -n "$npm_prefix" ]; then
      printf '%s/bin' "$npm_prefix"
    fi
  fi
}

knightcode_installed_path() {
  knightcode_bin_dir=$(knightcode_install_bin_dir)
  if [ -n "$knightcode_bin_dir" ]; then
    printf '%s/%s' "$knightcode_bin_dir" "$KNIGHTCODE_CMD"
  fi
}

installed_knightcode_is_first_on_path() {
  installed_knightcode_path=$(knightcode_installed_path)
  [ -n "$installed_knightcode_path" ] || return 1

  active_knightcode_path=$(command -v "$KNIGHTCODE_CMD" 2>/dev/null) || return 1
  [ "$active_knightcode_path" = "$installed_knightcode_path" ]
}

shell_config_file() {
  current_shell=$(basename "${SHELL:-sh}")
  case "$current_shell" in
    fish) printf '%s/.config/fish/config.fish' "$HOME" ;;
    zsh) printf '%s/.zshrc' "${ZDOTDIR:-$HOME}" ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        printf '%s/.bashrc' "$HOME"
      else
        printf '%s/.profile' "$HOME"
      fi
      ;;
    *) printf '%s/.profile' "$HOME" ;;
  esac
}

path_update_command() {
  bin_dir="$1"
  current_shell=$(basename "${SHELL:-sh}")
  if [ "$bin_dir" = "$HOME/.local/bin" ]; then
    bin_expr='$HOME/.local/bin'
  else
    bin_expr="$bin_dir"
  fi

  case "$current_shell" in
    fish) printf 'fish_add_path "%s"' "$bin_expr" ;;
    *) printf 'export PATH="%s:$PATH"' "$bin_expr" ;;
  esac
}

config_file_mentions_path() {
  config_file="$1"
  command="$2"

  [ -f "$config_file" ] || return 1
  grep -Fxq "$command" "$config_file"
}

prompt_add_path_to_profile() {
  bin_dir="$1"
  if ! ( : <>/dev/tty ) 2>/dev/null; then
    return 1
  fi

  config_file=$(shell_config_file)
  command=$(path_update_command "$bin_dir")

  if config_file_mentions_path "$config_file" "$command"; then
    printf 'A PATH update for %s already exists in %s.\n' "$bin_dir" "$config_file"
    return 0
  fi

  exec 3<>/dev/tty
  printf 'Add %s to your PATH in %s now? [Y/n] ' "$bin_dir" "$config_file" >&3
  if ! IFS= read -r answer <&3; then
    answer=
  fi
  exec 3>&-
  case "$answer" in
    n|N|no|NO) return 1 ;;
    *) ;;
  esac

  mkdir -p "${config_file%/*}"
  touch "$config_file"
  printf '\n# KnightCode\n%s\n' "$command" >> "$config_file"
  printf 'Added %s to %s.\n' "$bin_dir" "$config_file"
}

print_knightcode_not_on_path_message() {
  knightcode_bin_dir=$(knightcode_install_bin_dir)
  active_knightcode_path=$(command -v "$KNIGHTCODE_CMD" 2>/dev/null || true)

  printf 'KnightCode was installed, but your shell is not using that install yet.\n'
  if [ -n "$active_knightcode_path" ]; then
    printf 'Your shell currently resolves knightcode to: %s\n' "$active_knightcode_path"
  fi

  if [ -n "$knightcode_bin_dir" ]; then
    prompt_add_path_to_profile "$knightcode_bin_dir" || true
    command=$(path_update_command "$knightcode_bin_dir")
    printf 'Restart your shell or run:\n\n'
    printf '  %s\n\n' "$command"
    printf 'Then run: knightcode\n'
  else
    printf "Check npm's global prefix with:\n\n"
    printf '  npm prefix -g\n\n'
    printf 'Then add its bin directory to your shell PATH.\n'
  fi
}

default_knightcode_action() {
  existing_knightcode_path="$1"

  if [ "$KNIGHTCODE_LEGACY_NPM_MIGRATION" = 1 ]; then
    printf 'migrate'
  elif [ -n "$existing_knightcode_path" ]; then
    printf 'reinstall'
  else
    printf 'install'
  fi
}

choose_knightcode_action() {
  existing_knightcode_path="$1"

  if ! ( : <>/dev/tty ) 2>/dev/null; then
    print_knightcode_action_menu "$existing_knightcode_path"
    printf 'No terminal detected; continuing without confirmation.\n'
    KNIGHTCODE_INSTALL_ACTION=$(default_knightcode_action "$existing_knightcode_path")
    print_knightcode_action_selection "$KNIGHTCODE_INSTALL_ACTION"
    return 0
  fi

  exec 3<>/dev/tty
  trap 'exec 3>&-; trap - INT TERM; exit 130' INT TERM
  print_knightcode_action_menu "$existing_knightcode_path" >&3

  while :; do
    key=$(read_tty_key)

    case "$key" in
      ""|" "|"$KNIGHTCODE_CR"|y|Y)
        KNIGHTCODE_INSTALL_ACTION=$(default_knightcode_action "$existing_knightcode_path")
        break
        ;;
      u|U)
        if [ -n "$existing_knightcode_path" ]; then
          KNIGHTCODE_INSTALL_ACTION=uninstall
          break
        fi
        ;;
      "$KNIGHTCODE_ETX")
        exit 130
        ;;
      n|N|"$KNIGHTCODE_ESC")
        KNIGHTCODE_INSTALL_ACTION=none
        break
        ;;
    esac

    printf 'Please choose one of the listed keys.\n' >&3
  done

  print_knightcode_action_selection "$KNIGHTCODE_INSTALL_ACTION" >&3
  exec 3>&-
  trap - INT TERM
}

print_knightcode_action_menu() {
  existing_knightcode_path="$1"

  reset=
  dim=
  bold=
  cyan=
  green=
  red=
  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    reset="${KNIGHTCODE_ESC}[0m"
    dim="${KNIGHTCODE_ESC}[2m"
    bold="${KNIGHTCODE_ESC}[1m"
    cyan="${KNIGHTCODE_ESC}[36m"
    green="${KNIGHTCODE_ESC}[32m"
    red="${KNIGHTCODE_ESC}[31m"
  fi

  if [ -n "$existing_knightcode_path" ]; then
    printf '%sKnightCode is already installed at:%s\n\n' "$bold" "$reset"
    printf '  %s\n\n' "$existing_knightcode_path"
  fi

  if [ -n "${KNIGHTCODE_NPM_INSTALL_PREFIX:-}" ]; then
    printf "npm's global directory is not writable; KnightCode will be installed under %s.\n\n" "$KNIGHTCODE_NPM_INSTALL_PREFIX"
  fi

  if [ "$KNIGHTCODE_LEGACY_NPM_MIGRATION" = 1 ]; then
    printf 'This KnightCode was installed with npm. KnightCode now uses a managed installation\n'
    printf 'that pins all dependencies and updates itself with: knightcode update\n\n'
    printf '%sMigration:%s\n\n  ' "$bold" "$reset"
  elif knightcode_managed_install_enabled; then
    if [ -n "$existing_knightcode_path" ]; then
      printf '%sReinstallation:%s\n\n  ' "$bold" "$reset"
    else
      printf '%sInstallation:%s\n\n  ' "$bold" "$reset"
    fi
  elif [ -n "$existing_knightcode_path" ]; then
    printf '%sReinstall command:%s\n\n  ' "$bold" "$reset"
  else
    printf '%sInstall command:%s\n\n  ' "$bold" "$reset"
  fi
  print_knightcode_install_command
  printf '\n\n'

  printf '%sChoose an action:%s\n\n' "$bold" "$reset"
  if [ "$KNIGHTCODE_LEGACY_NPM_MIGRATION" = 1 ]; then
    printf '  %s%-4s%s %sMigrate KnightCode to a managed installation%s %s(default)%s\n' "$cyan" 'y' "$reset" "$green" "$reset" "$dim" "$reset"
    printf '  %s%-4s%s %sUninstall KnightCode%s\n' "$cyan" 'u' "$reset" "$red" "$reset"
  elif [ -n "$existing_knightcode_path" ]; then
    printf '  %s%-4s%s %sReinstall KnightCode%s %s(default)%s\n' "$cyan" 'y' "$reset" "$green" "$reset" "$dim" "$reset"
    printf '  %s%-4s%s %sUninstall KnightCode%s\n' "$cyan" 'u' "$reset" "$red" "$reset"
  else
    printf '  %s%-4s%s %sInstall KnightCode%s %s(default)%s\n' "$cyan" 'y' "$reset" "$green" "$reset" "$dim" "$reset"
  fi
  printf '  %s%-4s%s %sDo nothing%s\n' "$cyan" 'n' "$reset" "$dim" "$reset"
}

print_knightcode_action_selection() {
  case "$1" in
    install) message="Will install KnightCode." ;;
    reinstall) message="Will reinstall KnightCode." ;;
    migrate) message="Will migrate KnightCode to a managed installation." ;;
    uninstall) message="Will uninstall KnightCode." ;;
    none) message="Chose to do nothing. Exiting." ;;
  esac
  printf '\n%s\n\n' "$message"
}

restore_tty_state() {
  tty_state="$1"
  [ -n "$tty_state" ] || return 0
  stty "$tty_state" < /dev/tty 2>/dev/null || true
}

read_tty_key() {
  old_tty_state=$(stty -g < /dev/tty 2>/dev/null || true)
  trap 'restore_tty_state "$old_tty_state"; trap - INT TERM; exit 130' INT TERM
  stty -icanon -echo min 1 time 0 < /dev/tty 2>/dev/null || true
  if ! key=$(dd bs=1 count=1 2>/dev/null < /dev/tty); then
    key=
  fi
  restore_tty_state "$old_tty_state"
  trap - INT TERM
  printf '%s' "$key"
}

print_knightcode_install_command() {
  if [ "$KNIGHTCODE_LEGACY_NPM_MIGRATION" = 1 ]; then
    printf 'KnightCode will install to %s/%s, then remove the npm package:\n  ' "$KNIGHTCODE_MANAGED_BIN_DIR" "$KNIGHTCODE_CMD"
    print_npm_uninstall_command
  elif knightcode_managed_install_enabled; then
    printf 'KnightCode will install to %s/%s' "$KNIGHTCODE_MANAGED_BIN_DIR" "$KNIGHTCODE_CMD"
  elif [ -n "${KNIGHTCODE_NPM_INSTALL_PREFIX:-}" ]; then
    printf 'Using legacy self managed installation\n  npm install -g --ignore-scripts %s --prefix %s %s' "$KNIGHTCODE_NPM_INSTALL_MIN_AGE_ARG" "$KNIGHTCODE_NPM_INSTALL_PREFIX" "$KNIGHTCODE_PACKAGE"
  else
    printf 'Using legacy self managed installation\n  npm install -g --ignore-scripts %s %s' "$KNIGHTCODE_NPM_INSTALL_MIN_AGE_ARG" "$KNIGHTCODE_PACKAGE"
  fi
}

knightcode_managed_install_enabled() {
  [ "${KNIGHTCODE_LEGACY_INSTALL:-}" != 1 ]
}

ensure_managed_install_supported() {
  case "$(uname -s)" in
    Darwin|Linux) return 0 ;;
    *)
      printf 'Managed KnightCode installs currently support macOS and Linux only.\n' >&2
      return 1
      ;;
  esac
}

managed_install_marker_is_valid() {
  managed_root="$1"
  marker_path="$managed_root/$KNIGHTCODE_MANAGED_INSTALL_MARKER"
  [ -f "$marker_path" ] || return 1

  node - "$marker_path" <<'NODE' >/dev/null 2>&1
const fs = require("node:fs");
const marker = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (
	marker.kind !== "knightcode-managed-install" ||
	marker.schemaVersion !== 1 ||
	marker.layout !== "releases-v1"
) {
	process.exit(1);
}
NODE
}

managed_install_root_for_command() {
  managed_command_path="$1"
  [ -n "$managed_command_path" ] || return 1
  [ "${managed_command_path##*/}" = "$KNIGHTCODE_CMD" ] || return 1

  managed_candidate=${managed_command_path%/*}
  if managed_install_marker_is_valid "$managed_candidate"; then
    printf '%s' "$managed_candidate"
    return 0
  fi

  if ! managed_resolved_command=$(node - "$managed_command_path" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
let resolved = path.resolve(process.argv[2]);
while (fs.lstatSync(resolved).isSymbolicLink()) {
	const target = fs.readlinkSync(resolved);
	resolved = path.resolve(path.dirname(resolved), target);
}
console.log(resolved);
NODE
  ); then
    return 1
  fi
  [ "${managed_resolved_command##*/}" = "$KNIGHTCODE_CMD" ] || return 1
  managed_resolved_bin=${managed_resolved_command%/*}
  [ "${managed_resolved_bin##*/}" = bin ] || return 1
  managed_candidate=${managed_resolved_bin%/*}/install
  if managed_install_marker_is_valid "$managed_candidate"; then
    printf '%s' "$managed_candidate"
    return 0
  fi
  return 1
}

select_managed_install_dir() {
  existing_knightcode_path="$1"

  if [ -n "${KNIGHTCODE_MANAGED_INSTALL_ROOT:-}" ]; then
    managed_candidate=${KNIGHTCODE_MANAGED_INSTALL_ROOT%/}
    if managed_install_marker_is_valid "$managed_candidate"; then
      printf '%s' "$managed_candidate"
      return 0
    fi
  fi

  if managed_candidate=$(managed_install_root_for_command "$existing_knightcode_path"); then
    printf '%s' "$managed_candidate"
    return 0
  fi

  managed_agent_dir=${KNIGHTCODE_CODING_AGENT_DIR:-$HOME/.knightcode/agent}
  printf '%s/install' "${managed_agent_dir%/}"
}

select_managed_path_bin_dir() {
  managed_agent_dir="$1"
  managed_root="$2"
  existing_knightcode_path="$3"

  if [ -n "$existing_knightcode_path" ] && managed_existing_root=$(managed_install_root_for_command "$existing_knightcode_path") && [ "$managed_existing_root" = "$managed_root" ]; then
    managed_existing_bin=${existing_knightcode_path%/*}
    if [ "$managed_existing_bin" != "$managed_root" ]; then
      printf '%s' "$managed_existing_bin"
      return 0
    fi
  fi

  managed_path_ifs=${IFS- }
  IFS=:
  for managed_path_dir in ${PATH:-}; do
    IFS=$managed_path_ifs
    managed_path_dir=${managed_path_dir%/}
    case "$managed_path_dir" in
      "$managed_agent_dir/bin"|"$HOME/.local/bin"|"$HOME/bin"|"$HOME/.bin"|"$HOME/local/bin")
        if path_is_writable_or_creatable "$managed_path_dir" && managed_path_bin_dir_is_free "$managed_path_dir" "$managed_root"; then
          printf '%s' "$managed_path_dir"
          return 0
        fi
        ;;
    esac
    IFS=:
  done
  IFS=$managed_path_ifs

  # Homebrew's bin directory (/opt/homebrew/bin, Intel /usr/local/bin,
  # Linuxbrew) is user-writable and on PATH for most macOS developers, where
  # ~/.local/bin is not a default. Recognize it by the brew executable.
  IFS=:
  for managed_path_dir in ${PATH:-}; do
    IFS=$managed_path_ifs
    managed_path_dir=${managed_path_dir%/}
    if [ -n "$managed_path_dir" ] && [ -x "$managed_path_dir/brew" ] && [ -w "$managed_path_dir" ] && managed_path_bin_dir_is_free "$managed_path_dir" "$managed_root"; then
      printf '%s' "$managed_path_dir"
      return 0
    fi
    IFS=:
  done
  IFS=$managed_path_ifs

  printf '%s/bin' "$managed_agent_dir"
}

# A bin directory can host the managed entrypoint when it has no knightcode
# command yet, or when that command already belongs to this managed install.
# Refuse to replace a knightcode that was installed some other way.
managed_path_bin_dir_is_free() {
  free_bin_dir="$1"
  free_managed_root="$2"

  if [ ! -e "$free_bin_dir/$KNIGHTCODE_CMD" ] && [ ! -L "$free_bin_dir/$KNIGHTCODE_CMD" ]; then
    return 0
  fi
  free_existing_root=$(managed_install_root_for_command "$free_bin_dir/$KNIGHTCODE_CMD" 2>/dev/null) || return 1
  [ "$free_existing_root" = "$free_managed_root" ]
}

install_knightcode_package() {
  if [ -t 1 ] && [ "${TERM:-}" != "dumb" ]; then
    install_knightcode_package_with_progress
  else
    printf 'Installing KnightCode...\n\n'
    run_knightcode_install error
  fi
}

run_knightcode_install() {
  npm_loglevel="$1"
  if knightcode_managed_install_enabled; then
    run_managed_install_knightcode "$npm_loglevel"
  else
    run_npm_install_knightcode "$npm_loglevel"
  fi
}

run_npm_install_knightcode() {
  npm_loglevel="$1"
  if [ -n "${KNIGHTCODE_NPM_INSTALL_PREFIX:-}" ]; then
    npm install -g --ignore-scripts "$KNIGHTCODE_NPM_INSTALL_MIN_AGE_ARG" --prefix "$KNIGHTCODE_NPM_INSTALL_PREFIX" --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false "$KNIGHTCODE_PACKAGE"
  else
    npm install -g --ignore-scripts "$KNIGHTCODE_NPM_INSTALL_MIN_AGE_ARG" --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false "$KNIGHTCODE_PACKAGE"
  fi
}

download_installer_artifact() {
  url="$1"
  output="$2"
  label="$3"

  if ! command -v curl >/dev/null 2>&1; then
    printf 'curl is not available for the managed installer.\n' >&2
    return 1
  fi

  http_status=$(curl -L -sS -w '%{http_code}' -o "$output" "$url") || {
    rm -f "$output"
    printf 'Could not download %s from %s.\n' "$label" "$url" >&2
    return 1
  }

  if [ "$http_status" = 200 ]; then
    return 0
  fi

  rm -f "$output"
  printf 'Managed installer %s is unavailable at %s (HTTP %s).\n' "$label" "$url" "$http_status" >&2
  return 1
}

managed_install_release_version() {
  metadata_path="$1"

  node - "$metadata_path" <<'NODE'
const fs = require("node:fs");
const metadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const version = metadata.version;

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version ?? "")) {
	throw new Error("managed installer metadata has an invalid version");
}
console.log(version);
NODE
}

download_managed_install_artifacts() {
  managed_stage_dir="$1"

  printf 'Downloading managed installer release metadata\n' >&2
  download_installer_artifact "$KNIGHTCODE_INSTALLER_API_BASE/latest" "$managed_stage_dir/metadata.json" "release metadata" || return 1

  if ! managed_version=$(managed_install_release_version "$managed_stage_dir/metadata.json"); then
    printf 'Managed installer release metadata is invalid.\n' >&2
    return 1
  fi

  printf 'Downloading managed installer package.json for KnightCode %s\n' "$managed_version" >&2
  download_installer_artifact "$KNIGHTCODE_INSTALLER_API_BASE/$managed_version/package.json" "$managed_stage_dir/package.json" "package.json" || return 1

  printf 'Downloading managed installer package-lock.json for KnightCode %s\n' "$managed_version" >&2
  download_installer_artifact "$KNIGHTCODE_INSTALLER_API_BASE/$managed_version/package-lock.json" "$managed_stage_dir/package-lock.json" "package-lock.json" || return 1

  validate_managed_install_artifacts "$managed_stage_dir/package.json" "$managed_stage_dir/package-lock.json" "$managed_version"
}

validate_managed_install_artifacts() {
  package_json_path="$1"
  package_lock_path="$2"
  managed_version="$3"

  node - "$package_json_path" "$package_lock_path" "$KNIGHTCODE_PACKAGE" "$managed_version" <<'NODE'
const fs = require("node:fs");
const packageJson = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const packageLock = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const cliPackage = process.argv[4];
const version = process.argv[5];
const root = packageLock.packages?.[""];
const cliEntry = packageLock.packages?.[`node_modules/${cliPackage}`];

if (packageJson.version !== version || packageJson.dependencies?.[cliPackage] !== version) {
	throw new Error(`managed installer package.json must describe ${cliPackage}@${version}`);
}
if (packageLock.lockfileVersion !== 3) {
	throw new Error("managed installer package-lock.json must use lockfileVersion 3");
}
if (packageLock.version !== version || root?.version !== version || root?.dependencies?.[cliPackage] !== version) {
	throw new Error(`managed installer package-lock.json root must describe ${cliPackage}@${version}`);
}
if (cliEntry?.version !== version) {
	throw new Error(`managed installer package-lock.json does not include ${cliPackage}@${version}`);
}
NODE
}

write_managed_install_marker() {
  managed_root="$1"
  managed_entrypoint_type="$2"
  managed_entrypoint_path="$3"
  marker_tmp="$managed_root/$KNIGHTCODE_MANAGED_INSTALL_MARKER.tmp.$$"

  node - "$marker_tmp" "$managed_entrypoint_type" "$managed_entrypoint_path" <<'NODE'
const fs = require("node:fs");
const markerPath = process.argv[2];
const entrypointType = process.argv[3];
const entrypointPath = process.argv[4];
fs.writeFileSync(
	markerPath,
	`${JSON.stringify(
		{
			kind: "knightcode-managed-install",
			schemaVersion: 1,
			layout: "releases-v1",
			entrypoint: { type: entrypointType, path: entrypointPath },
		},
		null,
		2,
	)}\n`,
);
NODE
  mv -f "$marker_tmp" "$managed_root/$KNIGHTCODE_MANAGED_INSTALL_MARKER"
}

managed_install_entrypoint_path() {
  managed_root="$1"

  node - "$managed_root/$KNIGHTCODE_MANAGED_INSTALL_MARKER" <<'NODE'
const fs = require("node:fs");
const marker = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (typeof marker.entrypoint?.path !== "string" || !marker.entrypoint.path) process.exit(1);
console.log(marker.entrypoint.path);
NODE
}

write_managed_install_launcher() {
  managed_agent_dir="$1"
  managed_launcher_dir="$managed_agent_dir/bin"
  managed_launcher="$managed_launcher_dir/$KNIGHTCODE_CMD"
  launcher_tmp="$managed_launcher.tmp.$$"

  # Callers verified the managed marker, so an existing launcher is ours and is
  # rewritten to pick up launcher fixes on reinstall.
  if [ -e "$managed_launcher" ] && [ ! -f "$managed_launcher" ]; then
    return 1
  fi

  mkdir -p "$managed_launcher_dir"
  cat >"$launcher_tmp" <<'EOF'
#!/bin/sh
case "$0" in
  */*) knightcode_launcher="$0" ;;
  *) knightcode_launcher=$(command -v "$0") || exit 127 ;;
esac
while [ -L "$knightcode_launcher" ]; do
  knightcode_link=$(readlink "$knightcode_launcher") || exit 1
  case "$knightcode_link" in
    /*) knightcode_launcher="$knightcode_link" ;;
    *) knightcode_launcher=${knightcode_launcher%/*}/$knightcode_link ;;
  esac
done
knightcode_bin_dir=${knightcode_launcher%/*}
knightcode_agent_dir=${knightcode_bin_dir%/*}
knightcode_current_file=$knightcode_agent_dir/install/current-version
if ! IFS= read -r knightcode_current_version < "$knightcode_current_file"; then
  printf 'Could not read managed KnightCode version from %s.\n' "$knightcode_current_file" >&2
  exit 1
fi
case "$knightcode_current_version" in
  ""|.|..|*[!0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._+-]*)
    printf 'Managed KnightCode version file is invalid: %s\n' "$knightcode_current_file" >&2
    exit 1
    ;;
esac
knightcode_release_dir=$knightcode_agent_dir/install/releases/$knightcode_current_version
knightcode_release_bin=$knightcode_release_dir/node_modules/.bin/knightcode
if [ ! -x "$knightcode_release_bin" ]; then
  printf 'Managed KnightCode executable is missing: %s\n' "$knightcode_release_bin" >&2
  exit 1
fi
# Node.js installed by the KnightCode installer is not added to shell profiles, so put
# it on PATH for knightcode's launcher and for child processes: npm in knightcode update and
# commands run through knightcode's bash tool.
knightcode_node_bin=${XDG_DATA_HOME:-$HOME/.local/share}/knightcode-node/current/bin
if [ -x "$knightcode_node_bin/node" ]; then
  PATH=$knightcode_node_bin:$PATH
  export PATH
fi
KNIGHTCODE_MANAGED_INSTALL_ROOT=$knightcode_agent_dir/install
export KNIGHTCODE_MANAGED_INSTALL_ROOT
exec "$knightcode_release_bin" "$@"
EOF
  chmod 755 "$launcher_tmp"
  mv -f "$launcher_tmp" "$managed_launcher"
}

write_managed_install_link() {
  managed_agent_dir="$1"
  managed_bin_dir="$2"
  managed_launcher="$managed_agent_dir/bin/$KNIGHTCODE_CMD"
  managed_entrypoint="$managed_bin_dir/$KNIGHTCODE_CMD"

  if [ "$managed_entrypoint" = "$managed_launcher" ]; then
    return 0
  fi
  mkdir -p "$managed_bin_dir"
  if [ -e "$managed_entrypoint" ] && [ ! -L "$managed_entrypoint" ]; then
    printf 'Refusing to replace the executable at %s.\n' "$managed_entrypoint" >&2
    return 1
  fi

  managed_link_target=$(node - "$managed_bin_dir" "$managed_launcher" <<'NODE'
const path = require("node:path");
console.log(path.relative(process.argv[2], process.argv[3]));
NODE
  )
  managed_link_tmp="$managed_bin_dir/.$KNIGHTCODE_CMD.tmp.$$"
  rm -f "$managed_link_tmp"
  ln -s "$managed_link_target" "$managed_link_tmp"
  mv -f "$managed_link_tmp" "$managed_entrypoint"
}

write_managed_current_version() {
  managed_root="$1"
  managed_version="$2"
  current_tmp="$managed_root/current-version.tmp.$$"

  printf '%s\n' "$managed_version" >"$current_tmp"
  mv -f "$current_tmp" "$managed_root/current-version"
}

print_npm_uninstall_command() {
  if [ -n "${KNIGHTCODE_NPM_UNINSTALL_PREFIX:-}" ]; then
    printf 'npm uninstall -g --prefix %s %s' "$KNIGHTCODE_NPM_UNINSTALL_PREFIX" "$KNIGHTCODE_PACKAGE"
  else
    printf 'npm uninstall -g %s' "$KNIGHTCODE_PACKAGE"
  fi
}

ensure_legacy_npm_knightcode_removable() {
  legacy_prefix=${KNIGHTCODE_NPM_UNINSTALL_PREFIX:-$(npm_global_prefix)}
  if [ -n "$legacy_prefix" ] && npm_prefix_supports_global_install "$legacy_prefix"; then
    return 0
  fi

  printf "npm's global directory is not writable, so the npm-installed KnightCode at %s cannot be removed.\n" "$KNIGHTCODE_EXISTING_PATH" >&2
  printf 'Remove it first with sudo, then run this installer again:\n\n  sudo ' >&2
  print_npm_uninstall_command >&2
  printf '\n' >&2
  return 1
}

remove_legacy_npm_knightcode() {
  npm_loglevel="$1"

  printf 'Removing npm-installed KnightCode\n' >&2
  run_npm_uninstall_knightcode "$npm_loglevel" || return
  hash -r
  if [ -e "$KNIGHTCODE_EXISTING_PATH" ] || [ -L "$KNIGHTCODE_EXISTING_PATH" ]; then
    printf 'npm uninstall finished, but knightcode is still present at %s.\n' "$KNIGHTCODE_EXISTING_PATH" >&2
    return 1
  fi
}

run_managed_install_knightcode() {
  npm_loglevel="$1"
  managed_root="$KNIGHTCODE_MANAGED_INSTALL_DIR"

  if [ "$KNIGHTCODE_INSTALL_ACTION" != migrate ] && [ -n "${KNIGHTCODE_EXISTING_PATH:-}" ]; then
    if ! managed_existing_root=$(managed_install_root_for_command "$KNIGHTCODE_EXISTING_PATH") || [ "$managed_existing_root" != "$managed_root" ]; then
      printf 'Managed install refused to replace KnightCode at %s. Uninstall it first.\n' "$KNIGHTCODE_EXISTING_PATH" >&2
      return 1
    fi
  fi
  if [ -e "$managed_root/$KNIGHTCODE_MANAGED_INSTALL_MARKER" ] && ! managed_install_marker_is_valid "$managed_root"; then
    printf 'The managed install marker at %s is invalid.\n' "$managed_root/$KNIGHTCODE_MANAGED_INSTALL_MARKER" >&2
    return 1
  fi
  managed_launcher="$KNIGHTCODE_MANAGED_AGENT_DIR/bin/$KNIGHTCODE_CMD"
  if { [ -e "$managed_launcher" ] || [ -L "$managed_launcher" ]; } && ! managed_install_marker_is_valid "$managed_root"; then
    printf 'Refusing to replace the unrecognized executable at %s.\n' "$managed_launcher" >&2
    return 1
  fi

  mkdir -p "$managed_root/staging" "$managed_root/releases"
  managed_stage_dir="$managed_root/staging/install-$$-$(date +%s)"
  rm -rf "$managed_stage_dir"
  mkdir -p "$managed_stage_dir"

  if ! download_managed_install_artifacts "$managed_stage_dir"; then
    rm -rf "$managed_stage_dir"
    return 1
  fi

  printf 'Installing managed KnightCode dependencies\n' >&2
  if (cd "$managed_stage_dir" && npm ci --ignore-scripts "$KNIGHTCODE_NPM_INSTALL_MIN_AGE_ARG" --omit=dev --include=optional --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false); then
    managed_status=0
  else
    managed_status=$?
  fi
  if [ "$managed_status" -ne 0 ]; then
    rm -rf "$managed_stage_dir"
    return "$managed_status"
  fi

  managed_staged_bin="$managed_stage_dir/node_modules/.bin/$KNIGHTCODE_CMD"
  if [ ! -x "$managed_staged_bin" ]; then
    printf 'Managed KnightCode executable was not created by npm ci.\n' >&2
    rm -rf "$managed_stage_dir"
    return 1
  fi

  printf 'Verifying managed KnightCode %s\n' "$managed_version" >&2
  if managed_installed_version=$("$managed_staged_bin" --version); then
    managed_status=0
  else
    managed_status=$?
  fi
  if [ "$managed_status" -ne 0 ]; then
    rm -rf "$managed_stage_dir"
    return "$managed_status"
  fi
  if [ "$managed_installed_version" != "$managed_version" ]; then
    printf 'Managed KnightCode smoke test returned version %s; expected %s.\n' "$managed_installed_version" "$managed_version" >&2
    rm -rf "$managed_stage_dir"
    return 1
  fi

  managed_release_dir="$managed_root/releases/$managed_version"
  printf 'Activating managed KnightCode %s\n' "$managed_version" >&2
  if [ -d "$managed_release_dir" ]; then
    rm -rf "$managed_stage_dir"
  elif ! mv "$managed_stage_dir" "$managed_release_dir"; then
    rm -rf "$managed_stage_dir"
    return 1
  fi

  # Remove the npm-installed KnightCode only after the managed release is verified, so a
  # failed download or npm ci leaves the existing installation working.
  if [ "$KNIGHTCODE_INSTALL_ACTION" = migrate ]; then
    remove_legacy_npm_knightcode "$npm_loglevel" || return
  fi

  if [ "$KNIGHTCODE_MANAGED_BIN_DIR/$KNIGHTCODE_CMD" = "$KNIGHTCODE_MANAGED_AGENT_DIR/bin/$KNIGHTCODE_CMD" ]; then
    managed_entrypoint_type=script
  else
    managed_entrypoint_type=symlink
  fi
  write_managed_install_marker "$managed_root" "$managed_entrypoint_type" "$KNIGHTCODE_MANAGED_BIN_DIR/$KNIGHTCODE_CMD"
  write_managed_install_launcher "$KNIGHTCODE_MANAGED_AGENT_DIR"
  write_managed_install_link "$KNIGHTCODE_MANAGED_AGENT_DIR" "$KNIGHTCODE_MANAGED_BIN_DIR"
  write_managed_current_version "$managed_root" "$managed_version"
  hash -r
  printf 'Managed KnightCode install complete\n' >&2
}

uninstall_knightcode_package() {
  if managed_uninstall_root=$(managed_install_root_for_command "$KNIGHTCODE_EXISTING_PATH"); then
    printf 'Uninstalling managed KnightCode...\n\n'
    managed_uninstall_agent=${managed_uninstall_root%/*}
    managed_uninstall_launcher="$managed_uninstall_agent/bin/$KNIGHTCODE_CMD"
    managed_uninstall_entrypoint=$(managed_install_entrypoint_path "$managed_uninstall_root" 2>/dev/null || true)
    if [ -n "$managed_uninstall_entrypoint" ] && [ "$managed_uninstall_entrypoint" != "$managed_uninstall_launcher" ] && [ -L "$managed_uninstall_entrypoint" ]; then
      rm -f "$managed_uninstall_entrypoint"
    fi
    if [ "$KNIGHTCODE_EXISTING_PATH" != "$managed_uninstall_launcher" ] && [ -L "$KNIGHTCODE_EXISTING_PATH" ]; then
      rm -f "$KNIGHTCODE_EXISTING_PATH"
    fi
    rm -f "$managed_uninstall_launcher"
    rm -rf "$managed_uninstall_root"
    hash -r
    if [ -e "$KNIGHTCODE_EXISTING_PATH" ] || [ -L "$KNIGHTCODE_EXISTING_PATH" ]; then
      printf '\nManaged uninstall finished, but knightcode is still present at:\n\n  %s\n' "$KNIGHTCODE_EXISTING_PATH" >&2
      return 1
    fi
    return 0
  fi

  if ! npm_package_is_installed_for_uninstall; then
    printf 'I found knightcode at:\n\n  %s\n\n' "$KNIGHTCODE_EXISTING_PATH" >&2
    printf 'but npm does not show %s installed there.\n' "$KNIGHTCODE_PACKAGE" >&2
    printf 'Nothing was removed.\n' >&2
    return 1
  fi

  printf 'Uninstalling KnightCode...\n\n'
  run_npm_uninstall_knightcode error
  hash -r

  if [ -e "$KNIGHTCODE_EXISTING_PATH" ] || [ -L "$KNIGHTCODE_EXISTING_PATH" ]; then
    printf '\nnpm uninstall finished, but knightcode is still present at:\n\n  %s\n' "$KNIGHTCODE_EXISTING_PATH" >&2
    return 1
  fi
}

npm_package_is_installed_for_uninstall() {
  if [ -n "${KNIGHTCODE_NPM_UNINSTALL_PREFIX:-}" ]; then
    npm ls -g --prefix "$KNIGHTCODE_NPM_UNINSTALL_PREFIX" --depth=0 "$KNIGHTCODE_PACKAGE" >/dev/null 2>&1
  else
    npm ls -g --depth=0 "$KNIGHTCODE_PACKAGE" >/dev/null 2>&1
  fi
}

run_npm_uninstall_knightcode() {
  npm_loglevel="$1"
  if [ -n "${KNIGHTCODE_NPM_UNINSTALL_PREFIX:-}" ]; then
    npm uninstall -g --prefix "$KNIGHTCODE_NPM_UNINSTALL_PREFIX" --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false "$KNIGHTCODE_PACKAGE"
  else
    npm uninstall -g --no-fund --no-audit "--loglevel=$npm_loglevel" --progress=false "$KNIGHTCODE_PACKAGE"
  fi
}

install_knightcode_package_with_progress() {
  log_file="${TMPDIR:-/tmp}/knightcode-installer-npm.$$"
  rm -f "$log_file"
  : >"$log_file"

  run_knightcode_install verbose >"$log_file" 2>&1 &
  npm_pid=$!

  printf '\033[?25l'
  animate_npm_install "$log_file" &
  progress_pid=$!
  trap 'kill "$npm_pid" 2>/dev/null || true; finish_install_progress "$progress_pid"; exit 130' INT TERM

  if wait "$npm_pid"; then
    status=0
  else
    status=$?
  fi

  finish_install_progress "$progress_pid"
  trap - INT TERM

  if [ "$status" -ne 0 ]; then
    printf '\033[31mInstallation failed.\033[0m\n\n'
    cat "$log_file"
    rm -f "$log_file"
    return "$status"
  fi

  rm -f "$log_file"
  if terminal_supports_unicode; then
    printf '  \033[32m✓\033[0m install complete\n'
  else
    printf '  \033[32mok\033[0m install complete\n'
  fi
}

finish_install_progress() {
  progress_pid="$1"

  kill "$progress_pid" 2>/dev/null || true
  wait "$progress_pid" 2>/dev/null || true
  printf '\r\033[K\033[?25h'
}

terminal_supports_unicode() {
  locale="${LC_ALL:-${LC_CTYPE:-${LANG:-}}}"

  case "$locale" in
    *UTF-8*|*utf-8*|*UTF8*|*utf8*) return 0 ;;
  esac

  case "${TERM_PROGRAM:-}" in
    Apple_Terminal|iTerm.app|vscode|WezTerm) return 0 ;;
  esac

  return 1
}

spinner_frame() {
  frame_step="$1"
  frame_count="$2"

  if [ "$frame_count" -eq 10 ]; then
    case $((frame_step % 10)) in
      0) printf '⠋' ;;
      1) printf '⠙' ;;
      2) printf '⠹' ;;
      3) printf '⠸' ;;
      4) printf '⠼' ;;
      5) printf '⠴' ;;
      6) printf '⠦' ;;
      7) printf '⠧' ;;
      8) printf '⠇' ;;
      *) printf '⠏' ;;
    esac
  else
    case $((frame_step % 4)) in
      0) printf '-' ;;
      1) printf '\\' ;;
      2) printf '|' ;;
      *) printf '/' ;;
    esac
  fi
}

animate_npm_install() {
  log_file="$1"

  if terminal_supports_unicode; then
    full="█"
    empty="░"
    frame_count=10
  else
    full="#"
    empty="-"
    frame_count=4
  fi

  step=0
  if knightcode_managed_install_enabled; then
    label="starting managed install"
  else
    label="starting npm install"
  fi
  while :; do
    frame=$(spinner_frame "$step" "$frame_count")
    if [ $((step % 5)) -eq 0 ]; then
      label=$(npm_install_progress_label "$log_file" "$label")
    fi
    draw_install_progress "$step" "$frame" "$label" "$full" "$empty"
    step=$((step + 1))
    sleep 0.08
  done
}

animate_node_install() {
  log_file="$1"
  method_label="$2"

  if terminal_supports_unicode; then
    full="█"
    empty="░"
    frame_count=10
  else
    full="#"
    empty="-"
    frame_count=4
  fi

  step=0
  label="starting ${method_label} install"
  while :; do
    frame=$(spinner_frame "$step" "$frame_count")
    if [ $((step % 5)) -eq 0 ]; then
      label=$(node_install_progress_label "$log_file" "$label")
    fi
    draw_install_progress "$step" "$frame" "$label" "$full" "$empty" "Installing Node.js"
    step=$((step + 1))
    sleep 0.08
  done
}

node_install_progress_label() {
  log_file="$1"
  label="$2"

  while IFS= read -r line; do
    line=${line##*"$KNIGHTCODE_CR"}
    case "$line" in
      "") ;;
      Resolving\ Node.js*) label="resolving Node.js binary" ;;
      Downloading\ Node.js*) label="$line" ;;
      Verifying\ Node.js*) label="verifying download" ;;
      Installing\ xz-utils*) label="installing xz-utils" ;;
      Extracting\ Node.js*) label="extracting Node.js" ;;
      Node.js\ installed*) label="Node.js installed" ;;
      Hit:*|Get:*|Ign:*) label="updating package lists" ;;
      Reading\ package\ lists*) label="reading package lists" ;;
      Building\ dependency\ tree*) label="resolving dependencies" ;;
      The\ following\ NEW\ packages*) label="installing dependencies" ;;
      Need\ to\ get*|Fetched\ *) label="$line" ;;
      Selecting\ previously\ unselected\ package*) label="selecting packages" ;;
      Preparing\ to\ unpack*) label="preparing packages" ;;
      Unpacking\ *|Setting\ up\ *) label="$line" ;;
      fetch\ *) label="fetching packages" ;;
      *Installing\ nodejs*) label="$line" ;;
      OK:\ *) label="$line" ;;
      ==\>\ Downloading*) label="downloading packages" ;;
      ==\>\ Installing*|==\>\ Upgrading*) label="$line" ;;
      ==\>\ Pouring*) label="installing package" ;;
      *already\ installed*) label="$line" ;;
    esac
  done < "$log_file"

  if [ "${#label}" -gt 64 ]; then
    label=$(printf '%.61s...' "$label")
  fi
  printf '%s' "$label"
}

npm_install_progress_label() {
  log_file="$1"
  label="$2"
  metadata_cache_count=0
  metadata_fetch_count=0
  tarball_cache_count=0
  tarball_fetch_count=0

  while IFS= read -r line; do
    line=${line%"$KNIGHTCODE_CR"}
    case "$line" in
      Downloading\ managed\ installer\ release\ metadata*)
        label="resolving managed release"
        ;;
      Downloading\ managed\ installer\ package.json*)
        label="fetching managed package manifest"
        ;;
      Downloading\ managed\ installer\ package-lock.json*)
        label="fetching managed package lock"
        ;;
      Installing\ managed\ KnightCode\ dependencies*)
        label="installing managed dependencies"
        ;;
      Verifying\ managed\ KnightCode*)
        label="verifying managed package"
        ;;
      Activating\ managed\ KnightCode*)
        label="activating managed package"
        ;;
      Removing\ npm-installed\ KnightCode*)
        label="removing npm-installed package"
        ;;
      Managed\ KnightCode\ install\ complete*)
        label="managed install complete"
        ;;
      npm\ verbose\ title\ npm\ install*|npm\ verbose\ title\ npm\ ci*)
        label="resolving packages"
        ;;
      npm\ http\ fetch\ GET\ *https://registry.npmjs.org/*.tgz*)
        tarball_fetch_count=$((tarball_fetch_count + 1))
        label="fetching tarballs (${tarball_fetch_count})"
        ;;
      npm\ http\ cache\ *@https://registry.npmjs.org/*.tgz*)
        tarball_cache_count=$((tarball_cache_count + 1))
        if [ "$tarball_fetch_count" -gt 0 ]; then
          label="fetching tarballs (${tarball_fetch_count})"
        else
          label="checking tarballs (${tarball_cache_count})"
        fi
        ;;
      npm\ http\ fetch\ GET\ *https://registry.npmjs.org/*)
        metadata_fetch_count=$((metadata_fetch_count + 1))
        label="fetching package metadata (${metadata_fetch_count})"
        ;;
      npm\ http\ cache\ https://registry.npmjs.org/*)
        metadata_cache_count=$((metadata_cache_count + 1))
        if [ "$metadata_fetch_count" -gt 0 ]; then
          label="fetching package metadata (${metadata_fetch_count})"
        else
          label="checking cached metadata (${metadata_cache_count})"
        fi
        ;;
      npm\ info\ run\ *)
        rest=${line#npm info run }
        package=${rest%% *}
        rest=${rest#* }
        script=${rest%% *}
        package=${package%@*}
        case "$line" in
          *\{\ code:*) label="finished ${script} for ${package}" ;;
          *) label="running ${script} for ${package}" ;;
        esac
        ;;
      changed\ *|added\ *|removed\ *|updated\ *|up\ to\ date\ *)
        label="$line"
        ;;
    esac
  done < "$log_file"

  printf '%s' "$label"
}

draw_install_progress() {
  step="$1"; frame="$2"; label="$3"; full="$4"; empty="$5"; title="${6:-Installing KnightCode}"

  reset="${KNIGHTCODE_ESC}[0m"
  dim="${KNIGHTCODE_ESC}[2m"
  coral="${KNIGHTCODE_ESC}[38;2;240;144;130m"
  blue="${KNIGHTCODE_ESC}[38;2;77;154;191m"
  gold="${KNIGHTCODE_ESC}[38;2;241;190;88m"
  turquoise="${KNIGHTCODE_ESC}[38;2;131;204;210m"
  bold="${KNIGHTCODE_ESC}[1m"

  width=28
  trail=8
  head=$((step % (width + trail)))
  bar=""

  i=0
  while [ "$i" -lt "$width" ]; do
    age=$((head - i))
    if [ "$age" -ge 0 ] && [ "$age" -lt "$trail" ]; then
      case "$age" in
        0|1) cell="${gold}${full}${reset}" ;;
        2|3) cell="${coral}${full}${reset}" ;;
        4|5) cell="${blue}${full}${reset}" ;;
        *) cell="${turquoise}${full}${reset}" ;;
      esac
    else
      cell="${dim}${empty}${reset}"
    fi
    bar="${bar}${cell}"
    i=$((i + 1))
  done

  printf '\r\033[K  %s%s%s %s %s%s%s %s' "$turquoise" "$frame" "$reset" "$bar" "$bold" "$title" "$reset" "$label"
}

knightcode_installer_main "$@"
