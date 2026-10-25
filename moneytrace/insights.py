"""Privacy-conscious, deterministic descriptive analytics for parsed statement rows.

All monetary aggregates use Decimal. Nothing here infers merchant identity, proves fraud,
asserts bank settlement, or estimates an account balance across unrelated accounts.
"""
from __future__ import annotations
from collections import defaultdict, Counter
from decimal import Decimal
from statistics import median
from .parsing import Transaction

ZERO = Decimal('0')


def cents(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.01')):.2f}"


def build_insights(transactions: list[Transaction], findings: list[dict], categorize) -> dict:
    daily = defaultdict(lambda: {'credits': ZERO, 'debits': ZERO, 'count': 0})
    months = defaultdict(lambda: {'credits': ZERO, 'debits': ZERO, 'count': 0})
    categories = defaultdict(lambda: {'debits': ZERO, 'count': 0})
    accounts = defaultdict(lambda: {'credits': ZERO, 'debits': ZERO, 'count': 0})
    debits = []
    all_dates = []

    for t in transactions:
        all_dates.append(t.date)
        for bucket in (daily[t.date], months[t.date[:7]], accounts[t.account]):
            bucket['credits'] += t.credit
            bucket['debits'] += t.debit
            bucket['count'] += 1
        if t.debit > ZERO:
            cat = categories[categorize(t)]
            cat['debits'] += t.debit
            cat['count'] += 1
            debits.append(t)

    def flow_rows(source, label):
        return [{label: key,
                 'credits': cents(item['credits']), 'debits': cents(item['debits']),
                 'net': cents(item['credits'] - item['debits']),
                 'transactions': item['count']}
                for key, item in sorted(source.items())]

    total_out = sum((t.debit for t in debits), ZERO)
    category_rows = sorted(({'category': k, 'debits': cents(v['debits']), 'transactions': v['count']}
                            for k, v in categories.items()), key=lambda x: (-Decimal(x['debits']), x['category']))
    account_rows = sorted(flow_rows(accounts, 'account'), key=lambda x: x['account'])
    largest = sorted(debits, key=lambda t: (-t.debit, t.date, t.id))[:8]
    finding_counts = Counter(str(f.get('category', 'other')) for f in findings)
    by_severity = Counter(str(f.get('severity', 'other')) for f in findings)

    return {
        'period': {'start': min(all_dates) if all_dates else None,
                   'end': max(all_dates) if all_dates else None,
                   'days_observed': len(daily)},
        'statistics': {
            'average_debit': cents(total_out / len(debits)) if debits else cents(ZERO),
            'median_debit': cents(Decimal(median([t.debit for t in debits]))) if debits else cents(ZERO),
            'largest_debit': cents(max((t.debit for t in debits), default=ZERO)),
            'outgoing_transactions': len(debits),
            'largest_category_share_percent': (
                cents(Decimal(category_rows[0]['debits']) / total_out * 100)
                if category_rows and total_out else cents(ZERO)),
        },
        'daily': flow_rows(daily, 'date'),
        'monthly': flow_rows(months, 'month'),
        'spending': category_rows,
        'accounts': account_rows,
        'findings_by_category': [{'category': k, 'count': v} for k, v in sorted(finding_counts.items())],
        'findings_by_severity': [{'severity': k, 'count': by_severity.get(k, 0)} for k in ('high', 'medium', 'info')],
        'largest_debits': [
            {'id': t.id, 'date': t.date, 'account': t.account,
             'description': t.description, 'amount': cents(t.debit), 'category': categorize(t)}
            for t in largest
        ],
        'interpretation': [
            'Trends describe only the uploaded statement periods, not your entire finances.',
            'Daily net flow is total credits minus debits; it is NOT an account balance.',
            'Transfers between uploaded accounts may appear as both a debit and a credit. Do not interpret gross flows as income or spending without review.',
            'Finding counts can overlap. They are investigation prompts, not confirmed losses.'
        ],
    }
