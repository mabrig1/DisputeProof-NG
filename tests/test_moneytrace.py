from datetime import datetime, timezone
from decimal import Decimal
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from moneytrace.api import app
from moneytrace.parsing import StatementError, parse_file
from moneytrace.analysis import analyze
from moneytrace.fixtures import demo, SAMPLES

NOW = "2026-10-25T07:42:00+00:00"


def test_demo_is_fictional_and_has_meaningful_findings():
    report = demo(NOW)
    assert report['demo'] is True
    assert report['summary']['transactions'] == 13
    assert report['summary']['credits'] == '290000.00'
    assert report['summary']['debits'] == '131750.00'
    assert report['summary']['statements'] == 2
    categories = {f['category'] for f in report['findings']}
    assert 'balance_gap' in categories
    assert 'unmatched_reversal' in categories
    assert 'possible_duplicate' in categories
    assert report['summary']['matched_cross_account_transfers'] >= 1
    assert report['statements'][0]['sha256'] == __import__('hashlib').sha256(SAMPLES['Demo-Access-Account.csv'].encode()).hexdigest()


def test_duplicate_reference_detected():
    data = b'Date,Narration,Debit,Credit,Balance,Ref\n2026-10-01,Start,0,0,20000,start\n2026-10-02,POS debit,2500,0,17500,REF00001\n2026-10-02,POS debit,2500,0,15000,REF00001\n'
    s = parse_file(data, 'Test.csv', NOW)
    result = analyze([s], NOW)
    assert len([f for f in result['findings'] if f['category']=='possible_duplicate']) == 1
    assert result['summary']['balance_pairs_checked'] == 2


def test_mismatch_detection_but_not_confirmed_loss():
    data = b'Date,Description,Debit,Credit,Balance\n2026-10-01,Open,0,0,10000\n2026-10-02,Debit,2000,0,7500\n'
    s = parse_file(data, 'Test.csv', NOW)
    f = analyze([s], NOW)['findings'][0]
    assert f['category'] == 'balance_gap'
    assert f['amount'] == '500.00'
    assert 'not proof' in f['description'].lower()


def test_ambiguous_positive_amounts_are_skipped():
    data=b'Date,Description,Amount,Balance\n2026-10-01,Ambiguous,200,500\n2026-10-02,Actual debit,-250,250\n'
    s=parse_file(data,'x.csv',NOW)
    assert len(s.transactions)==1
    assert s.skipped_rows==1
    assert s.transactions[0].debit == Decimal('250.00')


def test_excel_format():
    wb=Workbook(); ws=wb.active
    ws.append(['Date','Description','Debit','Credit','Balance'])
    ws.append(['2026-10-01','Opening',0,0,10000])
    ws.append(['2026-10-02','Payment',1000,0,9000])
    b=BytesIO();wb.save(b)
    s=parse_file(b.getvalue(),'account.xlsx',NOW)
    assert s.format=='xlsx' and len(s.transactions)==2


def test_no_guess_on_unsupported_or_empty():
    with pytest.raises(StatementError):
        parse_file(b'\x89PNG', 'picture.png', NOW)
    with pytest.raises(StatementError):
        parse_file(b'', 'bank.csv', NOW)


def test_api_is_stateless_and_limits_uploads(monkeypatch):
    monkeypatch.setenv("MONEYTRACE_UPLOAD_MODE", "local")
    client=TestClient(app, base_url="http://127.0.0.1:8000")
    demo_response=client.get('/api/demo')
    assert demo_response.status_code==200
    assert demo_response.headers['cache-control']=='no-store, private'
    assert "'self'" in demo_response.headers['content-security-policy']
    response=client.post('/api/analyze',files={'files':('statement.csv',SAMPLES['Demo-Access-Account.csv'].encode(),'text/csv')})
    assert response.status_code==200, response.text
    assert response.json()['summary']['statements']==1
    assert response.json()['demo'] is False
    assert client.get('/api/health').json()['storage']=='none'
    invalid=client.post('/api/analyze',files={'files':('evil.exe',b'evil','application/octet-stream')})
    assert invalid.status_code==415
    oversized=client.post('/api/analyze',files={'files':('big.csv',b'a'*(6*1024*1024+1),'text/csv')})
    assert oversized.status_code==413


def test_pdf_text_failure_is_explicit():
    # Should not pretend to parse an image-only PDF.
    from reportlab.pdfgen import canvas
    b=BytesIO();c=canvas.Canvas(b);c.drawString(50,700,'Scan');c.save()
    with pytest.raises(StatementError, match='scanned|image-only'):
        parse_file(b.getvalue(),'bank.pdf',NOW)


def test_text_pdf_extraction_requires_review():
    from reportlab.pdfgen import canvas
    b=BytesIO();c=canvas.Canvas(b);c.setFont('Courier',10)
    c.drawString(20,750,'Date Narration Debit Credit Balance')
    c.drawString(20,735,'2026-10-01 Opening 0.00 0.00 10000.00')
    c.drawString(20,720,'2026-10-02 POS PAYMENT 2000.00 0.00 8000.00')
    c.save()
    stmt=parse_file(b.getvalue(),'text.pdf',NOW)
    assert len(stmt.transactions)==2
    assert all(t.confidence=='review_needed' for t in stmt.transactions)
    assert any('PDF' in msg for msg in stmt.warnings)


def test_currency_unit_headers():
    data=b'Date,Description,Debit (NGN),Credit (NGN),Balance (NGN)\n2026-10-01,Open,0,0,1000\n2026-10-02,Transfer,200,0,800\n'
    stmt=parse_file(data,'units.csv',NOW)
    assert len(stmt.transactions)==2
