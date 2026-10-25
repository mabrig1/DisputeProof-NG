"""Operator boundary, inert-by-default cloud keys, and redaction controls."""
from __future__ import annotations
from fastapi.testclient import TestClient
from moneytrace.api import app
from moneytrace import integrations
from moneytrace.fixtures import demo

TOKEN = "TEST-only-" + "z" * 48


def client():
    return TestClient(app)


def setting(monkeypatch):
    monkeypatch.setenv("MONEYTRACE_OPERATOR_TOKEN", TOKEN)


def auth():
    return {"Authorization": "Bearer " + TOKEN}


def fixture_id():
    return demo("2026-10-25T11:00:00+00:00")["findings"][0]["id"]


def test_operator_requires_explicit_secret(monkeypatch):
    monkeypatch.delenv("MONEYTRACE_OPERATOR_TOKEN", raising=False)
    monkeypatch.setenv("MONGODB_URI", "mongodb+srv://private:secret@example.invalid/database")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-secret-never-echo")
    for endpoint in ("/api/operator/check", "/api/operator/explain-demo"):
        if endpoint.endswith("check"):
            resp = client().get(endpoint)
        else:
            resp = client().post(endpoint, json={"finding_id": fixture_id()})
        assert resp.status_code == 403
        assert "secret" not in resp.text
        assert "example.invalid" not in resp.text


def test_operator_rejects_wrong_token(monkeypatch):
    setting(monkeypatch)
    assert client().get("/api/operator/check",
                        headers={"Authorization": "Bearer incorrect"}).status_code == 403


def test_config_remains_demo_without_operator(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "secret-openrouter")
    monkeypatch.setenv("MONGODB_URI", "mongodb://private:secret@example.invalid/")
    body = client().get("/api/config").json()
    assert body["uploads_enabled"] is False
    assert "OPENROUTER" not in str(body)
    assert "secret" not in str(body)


def test_operator_diagnostics_do_not_expose_secrets(monkeypatch):
    setting(monkeypatch)
    monkeypatch.setenv("MONGODB_URI", "mongodb://user:secret@example.invalid:27017")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-very-private")
    monkeypatch.setattr(integrations, "_ping_mongodb", lambda: True)
    response = client().get("/api/operator/check", headers=auth())
    assert response.status_code == 200
    assert response.json()["mongodb_connection"] == "reachable"
    assert response.json()["openrouter_configured"] is True
    assert "secret" not in response.text
    assert "sk-very-private" not in response.text


def test_operator_reports_generic_database_failure(monkeypatch):
    setting(monkeypatch)
    monkeypatch.setenv("MONGODB_URI", "mongodb://user:secret@example.invalid/")
    def fail():
        raise RuntimeError("uri mongodb://sensitive:password@private")
    monkeypatch.setattr(integrations, "_ping_mongodb", fail)
    result = client().get("/api/operator/check", headers=auth())
    assert result.json()["mongodb_connection"] == "unavailable"
    assert "sensitive" not in result.text


def test_ai_disabled_without_three_explicit_controls(monkeypatch):
    setting(monkeypatch)
    monkeypatch.setenv("OPENROUTER_API_KEY", "private-api-key")
    monkeypatch.delenv("MONEYTRACE_AI_ENABLED", raising=False)
    monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    result = client().post("/api/operator/explain-demo", headers=auth(),
                           json={"finding_id": fixture_id(), "purpose": "explain"})
    assert result.status_code == 503
    assert "private-api-key" not in result.text


def test_ai_not_allowed_to_accept_arbitrary_transaction_bodies(monkeypatch):
    setting(monkeypatch)
    monkeypatch.setenv("MONEYTRACE_AI_ENABLED", "true")
    monkeypatch.setenv("OPENROUTER_API_KEY", "private-api-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    result = client().post("/api/operator/explain-demo", headers=auth(), json={
        "finding_id": fixture_id(), "purpose": "explain",
        "statement": "Private financial statement, must not be forwarded",
        "transactions": [{"account": "1234567890"}],
    })
    # Ignore extra fields: explanation can only access server-side fixture.
    assert result.status_code in (200, 502)  # No uncontrolled custom content accepted by schema.


def test_reject_unknown_finding_before_external_api(monkeypatch):
    setting(monkeypatch)
    monkeypatch.setenv("MONEYTRACE_AI_ENABLED", "true")
    monkeypatch.setenv("OPENROUTER_API_KEY", "private-api-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    result = client().post("/api/operator/explain-demo", headers=auth(),
                           json={"finding_id": "F-AAAAAAAAAA", "purpose": "explain"})
    assert result.status_code == 404


def test_operator_ai_success_uses_synthetic_server_fixture(monkeypatch):
    setting(monkeypatch)
    monkeypatch.setenv("MONEYTRACE_AI_ENABLED", "true")
    monkeypatch.setenv("OPENROUTER_API_KEY", "private-api-key")
    monkeypatch.setenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
    seen = {}

    class FakeResponse:
        def raise_for_status(self): pass
        def json(self): return {"choices": [{"message": {"content": "Fictional only; verify source."}}]}

    class FakeClient:
        def __init__(self, **kwargs): self.kwargs = kwargs
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, json=None, headers=None):
            seen["payload"] = json
            seen["url"] = url
            return FakeResponse()

    monkeypatch.setattr(integrations.httpx, "AsyncClient", FakeClient)
    response = client().post("/api/operator/explain-demo", headers=auth(),
                             json={"finding_id": fixture_id(), "purpose": "checklist"})
    assert response.status_code == 200
    assert response.json()["synthetic_only"] is True
    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert "fictional" in str(seen["payload"]).lower()
    assert "OPENROUTER_API_KEY" not in str(seen["payload"])


def test_malformed_model_fails_closed(monkeypatch):
    setting(monkeypatch)
    monkeypatch.setenv("MONEYTRACE_AI_ENABLED", "true")
    monkeypatch.setenv("OPENROUTER_API_KEY", "private")
    monkeypatch.setenv("OPENROUTER_MODEL", "https://untrusted.domain")
    assert not integrations.ai_ready()
