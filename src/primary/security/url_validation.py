"""
SSRF guard for *arr instance URLs.

Sniparr connects to user-supplied URLs (Sonarr, Radarr, etc.). This module
validates those URLs before any request is sent, rejecting targets that would
let an attacker use Sniparr as a proxy to reach internal services.

What we block: loopback (127.x, ::1), link-local (169.254.x), and unspecified
addresses. We also block the literal hostname 'localhost' since it always
resolves to loopback.

What we allow: RFC-1918 private ranges (10.x, 172.16.x, 192.168.x) because
Docker and LAN deployments legitimately need them. The Docker bridge hostnames
host.docker.internal and host.containers.internal are also allowed — the
container runtime injects them into /etc/hosts and they cannot be forged by
external DNS.

Hostnames are resolved and their IPs checked, so aliases that map to blocked
ranges are caught too.
"""

import ipaddress
import socket
from urllib.parse import urlparse


_ALLOWED_SCHEMES = {"http", "https"}
_BLOCKED_LITERAL_HOSTS = {"localhost"}
_DOCKER_BRIDGE_ALIASES = {"host.docker.internal", "host.containers.internal"}


def _is_dangerous_address(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return ip.is_loopback or ip.is_link_local or ip.is_unspecified


def _ips_for_host(host: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    """Resolve host to IP addresses. Returns empty list if resolution fails."""
    try:
        results = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return []

    addrs = []
    for family, _, _, _, sockaddr in results:
        raw = sockaddr[0]
        try:
            if family == socket.AF_INET:
                addrs.append(ipaddress.IPv4Address(raw))
            elif family == socket.AF_INET6:
                addrs.append(ipaddress.IPv6Address(raw))
        except ValueError:
            pass
    return addrs


def validate_instance_url(url: str) -> str | None:
    """Check a user-supplied *arr instance URL for safety.

    Returns an error string if the URL should be rejected, or None if it is
    acceptable. Callers should surface the error string to the user.
    """
    if not url or not url.strip():
        return "URL is required."

    try:
        parsed = urlparse(url.strip())
    except Exception:
        return "URL could not be parsed — use http:// or https://."

    scheme = (parsed.scheme or "").lower()
    if scheme not in _ALLOWED_SCHEMES:
        return f"Scheme '{scheme}' is not allowed. Use http:// or https://."

    host = (parsed.hostname or "").lower()
    if not host:
        return "URL must include a hostname (e.g. http://sonarr:8989)."

    if host in _BLOCKED_LITERAL_HOSTS:
        return (
            f"'{host}' is not allowed as a hostname. "
            "Use the container name or a routable hostname instead."
        )

    # Docker bridge aliases resolve to link-local on Podman but are legitimate.
    if host in _DOCKER_BRIDGE_ALIASES:
        return None

    # Literal IP address — check directly.
    try:
        addr = ipaddress.ip_address(host)
        if _is_dangerous_address(addr):
            return f"URL points to a restricted address ({addr}). Use a container name or routable hostname."
        return None
    except ValueError:
        pass

    # Hostname — resolve and check every returned IP.
    for addr in _ips_for_host(host):
        if _is_dangerous_address(addr):
            return (
                f"'{host}' resolves to a restricted address ({addr}). "
                "Use a container name or routable hostname."
            )

    # Hostname that didn't resolve: defer the failure to the connection test.
    return None
