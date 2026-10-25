"""Fail-closed transport gating for the bank-data upload endpoint."""
from fastapi.testclient import TestClient
from moneytrace.api import app
from moneytrace.fixtures import SAMPLES


def upload(client):
    return client.post('/api/analyze', files={'files': ('safe.csv', SAMPLES['Demo-Access-Account.csv'].encode(), 'text/csv')})


def test_hosted_demo_disallows_uploads(monkeypatch):
    monkeypatch.delenv('MONEYTRACE_UPLOAD_MODE', raising=False)
    client = TestClient(app)
    assert client.get('/api/config').json()['uploads_enabled'] is False
    r = upload(client)
    assert r.status_code == 403
    assert 'disabled' in r.json()['detail'].lower()
    assert r.headers['x-robots-tag'].startswith('noindex')
    assert r.headers['cache-control'] == 'no-store, private'


def test_demo_and_analytics_still_work(monkeypatch):
    monkeypatch.delenv('MONEYTRACE_UPLOAD_MODE', raising=False)
    r = TestClient(app).get('/api/demo')
    assert r.status_code == 200
    assert r.json()['demo'] is True
    assert r.json()['analytics']['monthly']


def test_local_mode_requires_loopback_client_and_host(monkeypatch):
    monkeypatch.setenv('MONEYTRACE_UPLOAD_MODE', 'local')
    external_client = TestClient(app, base_url='https://example.org')
    assert external_client.get('/api/config').json()['uploads_enabled'] is False
    assert upload(external_client).status_code == 403
    local = TestClient(app, base_url='http://127.0.0.1:8000')
    assert local.get('/api/config').json()['uploads_enabled'] is True
    assert upload(local).status_code == 200


def test_local_mode_rejects_foreign_origin(monkeypatch):
    monkeypatch.setenv('MONEYTRACE_UPLOAD_MODE', 'local')
    local = TestClient(app, base_url='http://127.0.0.1:8000')
    r = local.post('/api/analyze', headers={'Origin':'https://strange.example'},
                   files={'files': ('safe.csv', SAMPLES['Demo-Access-Account.csv'].encode(), 'text/csv')})
    assert r.status_code == 403
