"""MoneyTrace analytics invariants on completely fictitious transactions."""
from decimal import Decimal
from fastapi.testclient import TestClient
from moneytrace.api import app
from moneytrace.analysis import analyze
from moneytrace.parsing import parse_file
from moneytrace.fixtures import demo

NOW='2026-10-25T07:42:00+00:00'

def parse(text, name='fictional.csv'):
    return parse_file(text.encode(),name,NOW)

def test_daily_monthly_and_account_totals():
    s=parse('Date,Description,Debit,Credit,Balance\n2026-08-01,Opening,0,100.10,100.10\n2026-08-04,POS cafe,20.05,0,80.05\n2026-09-01,POS shop,10.05,0,70.00\n')
    report=analyze([s],NOW)
    a=report['analytics']
    assert report['schema_version']=='1.1'
    assert len(a['monthly'])==2
    assert a['monthly'][0]['credits']=='100.10'
    assert a['monthly'][0]['debits']=='20.05'
    assert a['monthly'][1]['debits']=='10.05'
    assert a['accounts'][0]['net']=='70.00'
    assert sum(Decimal(m['debits']) for m in a['monthly'])==Decimal(report['summary']['debits'])


def test_order_is_deterministic():
    s=parse('Date,Description,Debit,Credit,Balance\n2026-06-03,POS food,12,0,88\n2026-05-02,Salary,0,100,100\n')
    # Two-date descending input: insight dates still sorted ascending.
    a=analyze([s],NOW)['analytics']
    assert [m['month'] for m in a['monthly']]==['2026-05','2026-06']
    assert [d['date'] for d in a['daily']]==['2026-05-02','2026-06-03']


def test_average_median_largest_and_fractional_percentage():
    s=parse('Date,Description,Debit,Credit,Balance\n2026-05-01,POS first,10,0,90\n2026-05-02,POS second,20,0,70\n2026-05-03,Electric bill,30,0,40\n')
    a=analyze([s],NOW)['analytics']
    stats=a['statistics']
    assert stats['average_debit']=='20.00'
    assert stats['median_debit']=='20.00'
    assert stats['largest_debit']=='30.00'
    assert stats['largest_category_share_percent']=='50.00'


def test_no_debits_does_not_crash_or_divide_by_zero():
    s=parse('Date,Description,Debit,Credit,Balance\n2026-05-01,Salary,0,100,100\n')
    a=analyze([s],NOW)['analytics']
    assert a['statistics']['median_debit']=='0.00'
    assert a['statistics']['largest_category_share_percent']=='0.00'
    assert a['spending']==[] and a['largest_debits']==[]


def test_demo_analytics_no_confirmed_fraud_claim():
    a=demo(NOW)['analytics']
    assert a['daily']
    assert a['findings_by_severity'][0]['severity']=='high'
    assert 'NOT an account balance' in a['interpretation'][1]
    assert 'not confirmed losses' in a['interpretation'][3]


def test_api_includes_analytics_and_no_store():
    client=TestClient(app)
    resp=client.get('/api/demo')
    assert resp.status_code==200
    assert resp.json()['analytics']['accounts']
    assert resp.headers['cache-control']=='no-store, private'
    js=client.get('/static/insights.js')
    assert js.status_code==200 and b'vizFlowChart' in js.content
    assert "insights.js" in client.get('/').text
