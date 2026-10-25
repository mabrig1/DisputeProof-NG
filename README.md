# DisputeProof NG — MoneyTrace MVP

Working, mobile-friendly bank statement analyzer and transaction-dispute evidence review prototype by Mabrig Technologies. **Release status: synthetic demonstration / private proof-of-concept. Not approved for live customer financial data.**

## Real functions

- Locally analyze up to five **CSV, XLSX, or text-based PDF** statements (6 MB/file) in request memory. **Uploads are disabled by default and on any hosted deployment**; the public-facing UI supports synthetic examples only.
- Normalize transactions, summarize credits/debits/charges, and classify spending.
- Detect running-balance arithmetic mismatches, possible duplicate debits, explicitly failed debits without a matched reversal, and unmatched cross-account transfers.
- Explore and filter transactions, inspect reasoning and recommended verification steps.
- Hash original file bytes (SHA-256); reselect a file for browser-side hash comparison.
- Export unsigned JSON or browser Print → Save as PDF.
- Synthetic sample data auto-loads on startup; users can inspect the interface without uploading any personal data.

## Start locally

Requires Python 3.10+.

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000 — no banking credentials or MongoDB keys required. Default behavior is **synthetic demo only**. To enable uploads for controlled development on your own machine only:

```bash
# Linux/macOS:
MONEYTRACE_UPLOAD_MODE=local uvicorn main:app --host 127.0.0.1 --port 8000
# Windows PowerShell:
$env:MONEYTRACE_UPLOAD_MODE='local'; uvicorn main:app --host 127.0.0.1 --port 8000
```

The API permits these uploads only when the request Host and client are loopback and no known hosted-environment flag (such as VERCEL) is present. The local-only gate is **not a substitute for authorization**; do not tunnel, proxy, or deploy it for real customers. Stop local mode after testing.

## Tests

```bash
pip install pytest httpx
python -m pytest -q
```

## v0.4 Audit intelligence and coverage (October 25, 2026)

- **Arithmetic checkability** by statement: parsed/skipped rows, checkable adjacent running-balance pairs, arithmetic mismatches, date ordering and observed date bounds. Checkability **cannot certify completeness or authenticity**.
- One-to-one **candidate pairing** for likely self-transfers and failed-debit reversals; incoming credits cannot be reused for multiple outgoing transactions. Ambiguous candidates remain unassigned.
- Date-range-aware review findings distinguish limited observations from stronger candidate checks without asserting missing funds or financial settlement.
- Dashboard visualizations and matching/coverage sections in the downloadable CSV and JSON reports.
- 11 additional synthetic security and matching tests; no third-party chart or network services.

## v0.3 Safe staging boundary (not live customer ready)

- `/api/config` describes whether uploads are enabled. The default is `synthetic_demo`.
- `/api/analyze` rejects requests with HTTP 403 before parsing multipart bodies unless explicitly opted in on a loopback-only local server. This server-side enforcement remains effective if someone bypasses the disabled UI.
- An independent mock/synthetic `/api/demo` feeds the existing analytics visualizations.
- All responses include no-store/private caching and `X-Robots-Tag` noindex; TLS responses add HSTS.
- No production banking data, persistent vault, or signed evidence chain is supported.
- No deploy to `proof.mabrigkorie.org` until access protection, security review and owner promotion approval.

## Deployment (NOT done)

Vercel supports zero-configuration FastAPI deployments for a root `main.py` exporting `app`. For a private deployment, create a **separate Vercel project**, set the project root to this directory, verify build and route behavior, require access protection, test HTTPS and content-security headers, and then bind the desired domain using the values provided by Vercel. Do **not** publish a sensitive-data service until privacy/security testing and data-protection compliance have been completed. The repo contains no secrets or production connectors. The suggested URL `proof.mabrigkorie.org` is not configured by this package.

## Critical boundaries

- **Not an AI fraud detector.** An explainable rules engine; no LLM, bank APIs, account access, transaction settlement lookup, or real fund tracing.
- **Not proof of theft.** A flagged finding may reflect genuine purchases, omitted transaction rows, legitimate charges, or parsing errors. Do not add together finding amounts.
- **Text-PDF parsing is conservative.** Only supported rows with extractable text and an identifiable debit/credit/balance layout are interpreted. PDF warnings are prominent; scanned PDFs and many bank-specific layouts require bank export CSV/XLSX or future verified adapters.
- **In memory at the server, NOT fully offline/browser-local.** Uploads travel to the API over the connection you use. The API creates no persistent storage and returns structured transaction data in the response. Reverse-proxy logs, browser caching, hosting logs, the original file on device, and local screenshots are out of scope; use TLS and secure hosting. Headers request no-store.
- **Hash ≠ authentic record.** There is no digital signature, independent trusted timestamp, append-only database, regulatory integration, or public verification URL yet. Export is an **unsigned** evidence manifest. Do not label it externally verified.
- **No authentication or tenancy yet.** Even in demo-only mode, consider deployment protection. Do not deploy publicly and accept personal financial records until proper authentication, per-user access controls, consent, retention/deletion design, traffic controls, security audit, NDPA assessment, and incident-handling measures are implemented.
- Research outcomes from the synthetic dataset are **not field evidence** or evidence of consumer financial harm.

## Future upgrade path

1. Bank-specific statement adapters + human-in-the-loop column mapping for ambiguous PDFs.
2. Private identity/authentication, tenant isolation, input scanning, safe file quarantine, throttling, legal/privacy review.
3. Encrypted R2 storage with user consent, MongoDB event/metadata chain, cryptographic signing, independent timestamp anchor and recipient-scoped access.
4. Complaint lifecycle, regulator-compatible packages (subject to verification), response tracking.
5. Synthetic Kaggle benchmark with ground-truth labels and properly controlled usability study.

## Layout

- `moneytrace/parsing.py`: file ingestion and conservative normalization.
- `moneytrace/analysis.py`: deterministic rule engine.
- `moneytrace/matching.py`: unique transfer/reversal candidate matching.
- `moneytrace/quality.py`: arithmetic checkability and coverage limitations.
- `moneytrace/api.py`: upload endpoint and security headers.
- `moneytrace/fixtures.py`: fictional demo statements.
- `web/`: dependency-free responsive frontend.
- `tests/`: parsing and reconciliation checks.
- `sample_data/`: safe fictional CSV files.

## v0.2 — Analytics and visualizations

Open **Insights & charts** from the desktop sidebar or mobile navigation to explore:

- Monthly debit/credit bar chart, daily net cash-flow trend, and spending-composition donut.
- Account-by-account comparison, largest debits, flags by severity, and average/median debit.
- Downloadable CSV aggregates (daily, monthly, account, category) suitable for further research.
- `analytics` in every `/api/demo` and `/api/analyze` report; currency calculations use `Decimal`.
- Accessible SVG labels with chart tooltips; no third-party chart CDN or tracking scripts.

The analytics are **descriptive only**. Cross-account transfers can inflate the apparent
amount of gross money movement; neither net flows nor flagged values prove losses.
The sample is synthetic and not representative of banking outcomes. Run `python -m pytest -q`
to check the analytics invariants and ingestion tests.
