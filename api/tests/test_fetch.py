"""Importing media from a link: downloads work, and links can't reach the server's own network."""

import socket
from pathlib import Path

import httpx
import pytest

from auteur import fetch

PUBLIC = "93.184.215.14"


@pytest.fixture
def dns(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Fake DNS: host -> address."""
    table = {"cdn.example.com": PUBLIC, "evil.example.com": "10.0.0.5", "rebind.example.com": PUBLIC}

    def getaddrinfo(host, port, *args, **kwargs):
        try:
            ip = table.get(host) or str(__import__("ipaddress").ip_address(host))
        except ValueError:
            raise socket.gaierror(host) from None
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    monkeypatch.setattr(fetch.socket, "getaddrinfo", getaddrinfo)
    return table


def client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8000/projects", "http://localhost/x.mp4", "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/a.mp4", "http://[::1]/a.mp4", "http://[::ffff:127.0.0.1]/a.mp4", "http://evil.example.com/a.mp4",
])
def test_private_addresses_are_refused(url: str, dns, tmp_path: Path) -> None:
    def never(request):
        raise AssertionError(f"must not connect to {request.url}")

    with pytest.raises(fetch.FetchError, match="private or local|Couldn't find"):
        fetch.download(url, tmp_path, client(never))


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://cdn.example.com/a.mp4", "gopher://x/"])
def test_only_http_links(url: str, tmp_path: Path) -> None:
    with pytest.raises(fetch.FetchError, match="http"):
        fetch.download(url, tmp_path, client(lambda r: httpx.Response(200)))


def test_a_redirect_into_the_private_network_is_refused(dns, tmp_path: Path) -> None:
    def handler(request):
        assert request.url.host == "cdn.example.com", "followed the redirect to a private host"
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/"})

    with pytest.raises(fetch.FetchError, match="private or local"):
        fetch.download("https://cdn.example.com/video", tmp_path, client(handler))


def test_downloads_and_names_the_file_from_its_type(dns, tmp_path: Path) -> None:
    def handler(request):
        if request.url.path == "/go":
            return httpx.Response(302, headers={"location": "/files/1234?token=x"})
        return httpx.Response(200, content=b"\x00" * 1000, headers={"content-type": "video/mp4"})

    out = fetch.download("https://cdn.example.com/go", tmp_path, client(handler))
    assert out.name == "1234.mp4" and out.stat().st_size == 1000


def test_uses_the_name_the_server_gives(dns, tmp_path: Path) -> None:
    resp = httpx.Response(200, content=b"x", headers={"content-type": "application/octet-stream",
                                                      "content-disposition": 'attachment; filename="beach sunset.mov"'})
    assert fetch.download("https://cdn.example.com/dl", tmp_path, client(lambda r: resp)).name == "beach sunset.mov"


def test_a_web_page_is_not_media(dns, tmp_path: Path) -> None:
    page = httpx.Response(200, content=b"<html>", headers={"content-type": "text/html"})
    with pytest.raises(fetch.FetchError, match="isn't a video"):
        fetch.download("https://cdn.example.com/watch?v=1", tmp_path, client(lambda r: page))


def test_big_files_stop_downloading(dns, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fetch, "MAX_BYTES", 10)
    big = httpx.Response(200, content=b"x" * 50, headers={"content-type": "video/mp4"})
    with pytest.raises(fetch.FetchError, match="over"):
        fetch.download("https://cdn.example.com/big.mp4", tmp_path, client(lambda r: big))
    assert not list(tmp_path.iterdir())


def test_the_connected_address_is_checked_too(tmp_path: Path) -> None:
    """DNS rebinding: the real network path refuses a server that turns out to be local. Here a real
    local server answers, and the check on the connection must stop it."""
    import http.server
    import threading

    server = http.server.HTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with pytest.raises(fetch.FetchError, match="private or local"):
            fetch.download(f"http://127.0.0.1:{server.server_port}/", tmp_path)
        # Even when the name check is fooled (the name looked public), the socket's address is checked.
        real = fetch.check_host
        fetch.check_host = lambda host, port: None
        try:
            with pytest.raises(fetch.FetchError, match="private or local"):
                fetch.download(f"http://127.0.0.1:{server.server_port}/", tmp_path)
        finally:
            fetch.check_host = real
    finally:
        server.shutdown()
