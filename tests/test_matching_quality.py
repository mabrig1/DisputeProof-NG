"""Adversarial synthetic cases: no uploaded customer data."""
from moneytrace.analysis import analyze
from moneytrace.parsing import parse_file

NOW = '2026-10-25T07:42:00+00:00'
H = 'Date,Description,Debit,Credit,Balance,Reference\n'


def stmt(name, rows):
    return parse_file((H + rows).encode(), name, NOW)


def test_cross_account_credit_can_only_match_one_debit():
    bank = stmt('Access.csv', '2026-10-01,Start,0,0,1000,O\n'
                '2026-10-03,Transfer to own OPay,100,0,900,A\n'
                '2026-10-04,Transfer to own OPay,100,0,800,B\n')
    wallet = stmt('OPay.csv', '2026-10-01,Start,0,0,0,O\n'
                  '2026-10-04,Received own transfer,0,100,100,W\n')
    report = analyze([bank, wallet], NOW)
    audit = report['matching_audit']
    assert audit['possible_cross_account_matches'] == 1
    assert sorted(x['status'] for x in audit['transfers']) == ['coverage_limited', 'possible_match']
    assert report['summary']['matched_cross_account_transfers'] == 1


def test_ambiguous_multiple_credit_candidates_are_not_claimed_as_match():
    bank = stmt('Access.csv', '2026-10-03,Transfer to own OPay,100,0,900,A\n')
    wallet = stmt('OPay.csv', '2026-10-03,Received transfer,0,100,100,X\n'
                  '2026-10-03,Received transfer,0,100,200,Y\n')
    report = analyze([bank, wallet], NOW)
    assert report['matching_audit']['transfers'][0]['status'] == 'ambiguous'
    assert report['summary']['matched_cross_account_transfers'] == 0
    assert any(f['category']=='ambiguous_transfer' for f in report['findings'])


def test_named_wallet_is_not_wrongly_assigned_to_other_bank():
    bank = stmt('Access.csv', '2026-10-03,Transfer to own OPay,200,0,800,A\n')
    opay = stmt('OPay.csv', '2026-10-03,Open,0,0,0,X\n')
    other = stmt('Moniepoint.csv', '2026-10-03,Received transfer,0,200,200,M\n')
    report = analyze([bank, opay, other], NOW)
    assert report['matching_audit']['possible_cross_account_matches'] == 0
    assert report['matching_audit']['transfers'][0]['status'] == 'coverage_limited'


def test_failed_debits_cannot_reuse_same_refund():
    bank = stmt('Access.csv', '2026-10-02,FAILED transfer,50,0,950,R\n'
                '2026-10-03,FAILED transfer,50,0,900,R\n'
                '2026-10-04,Reversal,0,50,950,R\n')
    audit = analyze([bank], NOW)['matching_audit']
    assert audit['possible_reversals'] == 1
    assert sorted(x['status'] for x in audit['reversals']) == ['possible_reversal', 'window_incomplete']


def test_multiple_refunds_create_ambiguity():
    s = stmt('Access.csv','2026-10-02,FAILED transfer,50,0,950,R\n'
             '2026-10-03,Reversal,0,50,1000,R\n'
             '2026-10-04,Refund,0,50,1050,R\n')
    report = analyze([s],NOW)
    assert report['matching_audit']['possible_reversals'] == 0
    assert report['matching_audit']['reversals'][0]['status'] == 'ambiguous_reversal'
    assert any(f['category']=='ambiguous_reversal' for f in report['findings'])


def test_quality_accurate_checkability_and_mismatch_count():
    s=stmt('Access.csv','2026-10-01,Open,0,0,1000,A\n'
           '2026-10-02,POS payment,100,0,800,B\n'
           '2026-10-03,POS payment,100,0,,C\n')
    q=analyze([s],NOW)['reconciliation_quality']
    assert q['accounts'][0]['arithmetic_checkability_pct'] == 50.0
    assert q['totals']['pairs_checked'] == 1
    assert q['totals']['arithmetic_mismatches'] == 1
    assert 'NOT evidence' in q['interpretation']


def test_mixed_order_is_not_labeled_as_checked():
    s=stmt('Access.csv','2026-10-02,Open,0,0,900,A\n'
           '2026-10-01,POS payment,100,0,1000,B\n'
           '2026-10-03,POS payment,100,0,800,C\n')
    row=analyze([s],NOW)['reconciliation_quality']['accounts'][0]
    assert row['order_status']=='mixed_uncheckable'
    assert row['pairs_checked']==0


def test_distinct_filename_yields_distinct_ids_even_for_same_bytes():
    rows='2026-10-01,Open,0,0,1000,A\n'
    a=stmt('Access.csv',rows)
    b=stmt('Other.csv',rows)
    assert a.transactions[0].id != b.transactions[0].id


def test_external_transfer_is_not_assumed_in_owned_accounts():
    bank=stmt('Access.csv','2026-10-03,Transfer to external merchant,100,0,900,A\n')
    wallet=stmt('OPay.csv','2026-10-03,Start,0,0,0,X\n')
    r=analyze([bank,wallet],NOW)
    assert not r['matching_audit']['transfers']


def test_quality_includes_skipped_rows():
    body=(H+'2026-10-01,Open,0,0,1000,A\n'+'nonsense,none,20,0,0,X\n').encode()
    s=parse_file(body,'Access.csv',NOW)
    assert analyze([s],NOW)['reconciliation_quality']['totals']['skipped_rows']==1
