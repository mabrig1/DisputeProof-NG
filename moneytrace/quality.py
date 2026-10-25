"""Auditability indicators measured from submitted rows, not statement completeness."""
from __future__ import annotations
from .parsing import Statement


def reconciliation_quality(statements: list[Statement], findings: list[dict], chronological):
    results = []
    for s in statements:
        ordered = chronological(s.transactions)
        possible_pairs = max(0, len(s.transactions) - 1)
        checked = 0 if ordered is None else sum(
            a.balance is not None and b.balance is not None
            for a, b in zip(ordered, ordered[1:]))
        statement_txids = {t.id for t in s.transactions}
        mismatches = sum(f['category'] == 'balance_gap' and
                         all(txid in statement_txids for txid in f['transaction_ids'])
                         for f in findings)
        with_balance = sum(t.balance is not None for t in s.transactions)
        results.append({
            'filename': s.filename, 'account': s.account,
            'date_start': min((t.date for t in s.transactions), default=None),
            'date_end': max((t.date for t in s.transactions), default=None),
            'parsed_rows': len(s.transactions), 'skipped_rows': s.skipped_rows,
            'rows_with_balance': with_balance,
            'possible_adjacent_pairs': possible_pairs,
            'pairs_checked': checked, 'arithmetic_mismatches': mismatches,
            'arithmetic_checkability_pct': round(checked / possible_pairs * 100, 1) if possible_pairs else 0.0,
            'balance_presence_pct': round(with_balance / len(s.transactions) * 100, 1) if s.transactions else 0.0,
            'order_status': 'mixed_uncheckable' if ordered is None else 'order_consistent',
            'warning': ('Mixed date ordering: adjacency checks skipped.' if ordered is None
                        else 'Arithmetic checks cannot determine whether transactions were omitted or authorized.'),
        })
    return {
        'accounts': results,
        'totals': {
            'parsed_rows': sum(r['parsed_rows'] for r in results),
            'skipped_rows': sum(r['skipped_rows'] for r in results),
            'possible_adjacent_pairs': sum(r['possible_adjacent_pairs'] for r in results),
            'pairs_checked': sum(r['pairs_checked'] for r in results),
            'arithmetic_mismatches': sum(r['arithmetic_mismatches'] for r in results),
        },
        'interpretation': 'Checkability is the proportion of adjacent parsed rows with usable balances and consistent date ordering. It is NOT evidence that the statement is complete or that balances are authentic.',
    }
