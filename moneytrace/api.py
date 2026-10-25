"""Stateless bank statement audit API. Raw uploads stay only in request memory."""
from __future__ import annotations
from datetime import datetime, timezone
import os
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from .parsing import MAX_FILE_BYTES, StatementError, parse_file
from .analysis import analyze
from .fixtures import demo

BASE = Path(__file__).resolve().parents[1]
app = FastAPI(title="DisputeProof NG · MoneyTrace", version="0.4.0", docs_url=None, redoc_url=None)


def local_upload_allowed(request: Request) -> bool:
    """Deliberately NOT a public authentication mechanism. No remote uploads.

    Accept only explicit local opt-in plus loopback clients and loopback Host.
    Production/preview deployments must retain the default demo-only mode.
    """
    return (
        os.getenv("MONEYTRACE_UPLOAD_MODE", "demo").lower() == "local"
        and not any(os.getenv(name) for name in ("VERCEL", "CF_PAGES", "K_SERVICE", "RENDER"))
        and request.url.hostname in {"127.0.0.1", "localhost", "testserver"}
        and request.client is not None
        and request.client.host in {"127.0.0.1", "::1", "testclient"}
        and (
            request.headers.get("origin") is None
            or request.headers["origin"] in {
                "http://127.0.0.1:8000", "http://localhost:8000",
                "http://testserver"
            }
        )
    )


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response


class UploadGate(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Reject before FastAPI parses a multipart body on a hosted deployment.
        if request.url.path == "/api/analyze" and request.method == "POST":
            if not local_upload_allowed(request):
                return JSONResponse(status_code=403, content={
                    "detail": "Statement uploads are disabled. This is a synthetic-data demo; use local mode only for controlled tests."
                })
        return await call_next(request)


app.add_middleware(UploadGate)
app.add_middleware(SecurityHeaders)


@app.get("/api/health")
def health():
    return {"status":"ok", "mode":"demo_only_by_default", "storage":"none", "version":"0.4.0"}


@app.get("/api/config")
def config(request: Request):
    enabled = local_upload_allowed(request)
    return {"mode": "local_audit" if enabled else "synthetic_demo",
            "uploads_enabled": enabled, "max_files": 5, "max_file_mb": 6,
            "privacy_notice": "Real financial statements are not accepted in hosted demo mode."}


@app.get("/api/demo")
def synthetic_demo():
    return demo(datetime.now(timezone.utc).isoformat(timespec="seconds"))


@app.post("/api/analyze")
async def analyze_files(request: Request, files: list[UploadFile] = File(...)):
    if not local_upload_allowed(request):
        # Fail closed on hosted deployments, even when upload UI is bypassed.
        raise HTTPException(403, "Statement uploads are disabled. This is a synthetic-data demo; use local mode only for controlled tests.")
    if not 1 <= len(files) <= 5:
        raise HTTPException(400, "Upload between 1 and 5 files at a time.")
    if len({f.filename for f in files}) != len(files):
        raise HTTPException(400, "Upload filenames must be unique so accounts can be distinguished.")
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    statements = []
    for item in files:
        name = Path(item.filename or "statement").name
        if Path(name).suffix.lower() not in (".csv", ".xlsx", ".pdf"):
            raise HTTPException(415, f"{name}: Only CSV, XLSX, and text-based PDF files are accepted.")
        try:
            contents = await item.read(MAX_FILE_BYTES + 1)
            if len(contents) > MAX_FILE_BYTES:
                raise HTTPException(413, f"{name}: Maximum file size is 6 MB.")
            stmt = parse_file(contents, name, timestamp)
            statements.append(stmt)
        except StatementError as exc:
            raise HTTPException(422, f"{name}: {exc}")
        finally:
            await item.close()
    return analyze(statements, timestamp)


@app.get("/")
def home():
    return FileResponse(BASE / "web" / "index.html")

app.mount("/static", StaticFiles(directory=str(BASE / "web")), name="static")
