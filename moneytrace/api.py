"""Stateless bank statement audit API. Raw uploads stay only in request memory."""
from __future__ import annotations
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from .parsing import MAX_FILE_BYTES, StatementError, parse_file
from .analysis import analyze
from .fixtures import demo

BASE = Path(__file__).resolve().parents[1]
app = FastAPI(title="DisputeProof NG · MoneyTrace", version="0.1.0", docs_url=None, redoc_url=None)


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        return response


app.add_middleware(SecurityHeaders)


@app.get("/api/health")
def health():
    return {"status":"ok", "mode":"stateless", "storage":"none", "version":"0.1.0"}


@app.get("/api/demo")
def synthetic_demo():
    return demo(datetime.now(timezone.utc).isoformat(timespec="seconds"))


@app.post("/api/analyze")
async def analyze_files(files: list[UploadFile] = File(...)):
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
