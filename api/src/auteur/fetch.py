"""Download media from a link (the media bin's "Import from link").

A link is user input that makes the server open a connection, so it must not reach the server's own
network (SSRF: cloud metadata, the API itself, other containers). Only http(s); every address the host
resolves to must be public; redirects are followed by hand and each hop is checked again; and the
address actually connected to is checked too, which catches DNS answers that change between the check
and the connection (DNS rebinding).
"""

import ipaddress
import mimetypes
import re
import socket
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

import httpx

MAX_BYTES = 600 * 1024 * 1024  # same as an upload through Caddy
MAX_REDIRECTS = 5
TIMEOUT = httpx.Timeout(20.0, read=60.0)
SUFFIXES = {
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/wav": ".wav",
    "audio/x-wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "image/png": ".png",
    "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
}
MEDIA_SUFFIXES = set(SUFFIXES.values()) | {".m4v", ".jpeg", ".mkv"}


class FetchError(ValueError):
    """Why a link can't be imported, worded for the user."""


def check_address(ip: str) -> None:
    addr = ipaddress.ip_address(ip.split("%")[0])
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    if not addr.is_global or addr.is_multicast:
        raise FetchError("That link points to a private or local address")


def check_host(host: str, port: int) -> None:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise FetchError(f"Couldn't find the server {host!r}") from None
    for *_, sockaddr in infos:
        check_address(sockaddr[0])


def _filename(response: httpx.Response, url: str) -> str:
    cd = response.headers.get("content-disposition", "")
    m = re.search(r"filename\*?=(?:UTF-8'')?\"?([^\";]+)", cd, re.I)
    name = unquote(m.group(1)) if m else unquote(Path(urlsplit(url).path).name)
    name = re.sub(r"[^\w .()-]", "_", name).strip() or "download"
    suffix = Path(name).suffix.lower()
    if suffix not in MEDIA_SUFFIXES:
        ctype = response.headers.get("content-type", "").split(";")[0].strip().lower()
        guessed = SUFFIXES.get(ctype) or mimetypes.guess_extension(ctype) or ""
        if guessed.lower() not in MEDIA_SUFFIXES:
            raise FetchError("That link isn't a video, audio or picture file (open it and copy the direct file link)")
        name = f"{Path(name).stem or 'download'}{guessed}"
    return name[:120]


def download(url: str, dest_dir: Path, client: httpx.Client | None = None) -> Path:
    """Download `url` into `dest_dir`; returns the file (named after the link). Raises FetchError."""
    own = client is None
    client = client or httpx.Client(timeout=TIMEOUT, follow_redirects=False, headers={"User-Agent": "Auteur/1.0"})
    try:
        for _ in range(MAX_REDIRECTS + 1):
            parts = urlsplit(url)
            if parts.scheme not in ("http", "https") or not parts.hostname:
                raise FetchError("Use an http:// or https:// link")
            check_host(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
            with client.stream("GET", url) as r:
                stream = r.extensions.get("network_stream")
                peer = stream.get_extra_info("server_addr") if stream is not None else None
                if peer:
                    check_address(peer[0])
                if r.is_redirect:
                    url = urljoin(url, r.headers.get("location", ""))
                    continue
                if r.status_code != 200:
                    raise FetchError(f"The link answered {r.status_code}")
                if int(r.headers.get("content-length") or 0) > MAX_BYTES:
                    raise FetchError(f"The file is over {MAX_BYTES // 1024 // 1024} MB")
                out = dest_dir / _filename(r, url)
                size = 0
                with out.open("wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        size += len(chunk)
                        if size > MAX_BYTES:
                            f.close()
                            out.unlink(missing_ok=True)
                            raise FetchError(f"The file is over {MAX_BYTES // 1024 // 1024} MB")
                        f.write(chunk)
                return out
        raise FetchError("The link redirects too many times")
    except httpx.HTTPError as e:
        raise FetchError(f"Couldn't download it: {type(e).__name__}") from None
    finally:
        if own:
            client.close()
