// netguard: loaded into every process through /etc/ld.so.preload, it checks each connect() against the computer's
// abuse rules (apps/bots/src/computer/abuse.ts, written to /etc/netguard.conf by the bridge at start):
//   - blocked ports (SMTP and mining pool ports) are refused for everyone;
//   - a loopback port listed in /etc/netguard-ports (a bot's Chrome debugging or VNC port) only accepts its own bot
//     user and root, so one bot cannot drive or watch another bot's browser;
//   - new outbound TCP connections are limited per process per second.
// It covers dynamically linked programs (the shells, Chrome, Python, Node); it is a guard, not a sandbox.
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

#define MAX_PORTS 64

static int (*real_connect)(int, const struct sockaddr *, socklen_t);
static int blocked_ports[MAX_PORTS];
static int blocked_count;
static int rate_limit = 50;
static pthread_once_t loaded = PTHREAD_ONCE_INIT;
static pthread_mutex_t rate_lock = PTHREAD_MUTEX_INITIALIZER;
static time_t rate_second;
static int rate_count;

static void load(void) {
	real_connect = dlsym(RTLD_NEXT, "connect");
	FILE *file = fopen("/etc/netguard.conf", "r");
	if (!file) return;
	char key[16];
	int value;
	while (fscanf(file, "%15s %d", key, &value) == 2) {
		if (strcmp(key, "port") == 0 && blocked_count < MAX_PORTS) blocked_ports[blocked_count++] = value;
		else if (strcmp(key, "rate") == 0) rate_limit = value;
	}
	fclose(file);
}

/** The bot user that owns a loopback port, or -1. Read each time: ports are added as bots start. */
static long port_owner(int port) {
	FILE *file = fopen("/etc/netguard-ports", "r");
	if (!file) return -1;
	int listed;
	long uid;
	long owner = -1;
	while (fscanf(file, "%d %ld", &listed, &uid) == 2)
		if (listed == port) {
			owner = uid;
			break;
		}
	fclose(file);
	return owner;
}

static int refuse(int code) {
	errno = code;
	return -1;
}

int connect(int fd, const struct sockaddr *address, socklen_t length) {
	pthread_once(&loaded, load);
	if (!real_connect) return refuse(ENOSYS);
	if (!address) return real_connect(fd, address, length);
	int port = -1;
	int loopback = 0;
	if (address->sa_family == AF_INET && length >= sizeof(struct sockaddr_in)) {
		const struct sockaddr_in *in = (const struct sockaddr_in *)address;
		port = ntohs(in->sin_port);
		loopback = (ntohl(in->sin_addr.s_addr) >> 24) == 127;
	} else if (address->sa_family == AF_INET6 && length >= sizeof(struct sockaddr_in6)) {
		const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *)address;
		port = ntohs(in6->sin6_port);
		loopback = IN6_IS_ADDR_LOOPBACK(&in6->sin6_addr) ||
			(IN6_IS_ADDR_V4MAPPED(&in6->sin6_addr) && in6->sin6_addr.s6_addr[12] == 127);
	}
	if (port < 0) return real_connect(fd, address, length);
	for (int i = 0; i < blocked_count; i++)
		if (blocked_ports[i] == port && !loopback) return refuse(ECONNREFUSED);
	uid_t uid = getuid();
	if (loopback) {
		long owner = port_owner(port);
		if (owner >= 0 && uid != 0 && (long)uid != owner) return refuse(EACCES);
		return real_connect(fd, address, length);
	}
	int type = 0;
	socklen_t size = sizeof(type);
	if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &size) == 0 && type == SOCK_STREAM) {
		pthread_mutex_lock(&rate_lock);
		time_t now = time(NULL);
		if (now != rate_second) {
			rate_second = now;
			rate_count = 0;
		}
		int over = ++rate_count > rate_limit;
		pthread_mutex_unlock(&rate_lock);
		if (over) return refuse(EAGAIN);
	}
	return real_connect(fd, address, length);
}
