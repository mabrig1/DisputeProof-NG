"""One-to-one candidate matching on uploaded statement rows, never payment verification."""
from __future__ import annotations
from datetime import date
import re
from .parsing import Statement, Transaction

NOISE = {'demo', 'bank', 'account', 'wallet', 'statement', 'export', 'csv', 'xlsx', 'pdf', 'my', 'current', 'savings'}
FAILED = re.compile(r'\b(?:failed|declined|unsuccessful)\b', re.I)
TRANSFER = re.compile(r'\b(?:transfer|trf)\b', re.I)
SELF = re.compile(r'\b(?:self|own|my account|my wallet)\b', re.I)
REVERSAL = re.compile(r'\b(?:reversal|reversed|refund|refunded|reversing)\b', re.I)


def days_between(a: Transaction, b: Transaction) -> int:
    return (date.fromisoformat(b.date) - date.fromisoformat(a.date)).days


def tokens(label: str) -> set[str]:
    return {w for w in re.findall(r'[a-z]+', label.lower()) if len(w) >= 4 and w not in NOISE}


def statement_end(s: Statement) -> str | None:
    return max((t.date for t in s.transactions), default=None)


def reconcile_candidates(statements: list[Statement], make_finding) -> tuple[dict, list[dict]]:
    findings: list[dict] = []
    reversals: list[dict] = []
    transfers: list[dict] = []
    used_reversals: set[str] = set()
    used_credits: set[str] = set()

    for s in statements:
        for debit in sorted(s.transactions, key=lambda t: (t.date, t.line, t.id)):
            if debit.debit <= 0 or not FAILED.search(debit.description):
                continue
            eligible = [credit for credit in s.transactions
                        if credit.id not in used_reversals and credit.credit == debit.debit
                        and 0 <= days_between(debit, credit) <= 14
                        and ((debit.reference and credit.reference and
                              debit.reference.casefold() == credit.reference.casefold())
                             or REVERSAL.search(credit.description))]
            eligible.sort(key=lambda t: (abs(days_between(debit, t)), t.date, t.id))
            if len(eligible) == 1:
                credit = eligible[0]
                used_reversals.add(credit.id)
                reversals.append({'debit_id': debit.id, 'credit_id': credit.id,
                                  'amount': str(debit.debit), 'status': 'possible_reversal',
                                  'reason': 'Unique amount/date/reference-or-description candidate; not bank confirmation.'})
            elif len(eligible) > 1:
                reversals.append({'debit_id': debit.id, 'credit_id': None,
                                  'amount': str(debit.debit), 'status': 'ambiguous_reversal',
                                  'reason': 'Multiple possible credits. Manual verification required.'})
                findings.append(make_finding(
                    'ambiguous_reversal', 'medium', 'Multiple possible reversal credits',
                    'Several credits could relate to this reported failed debit; none was automatically accepted as a unique reversal.',
                    [debit], debit.debit,
                    'Compare bank references and original timestamps to identify the correct reversal.', 'low'))
            else:
                observed_until = statement_end(s)
                full_window = (observed_until is not None and
                               (date.fromisoformat(observed_until) - date.fromisoformat(debit.date)).days >= 14)
                reversals.append({'debit_id': debit.id, 'credit_id': None,
                                  'amount': str(debit.debit),
                                  'status': 'not_observed' if full_window else 'window_incomplete',
                                  'reason': 'No qualifying reversal in provided rows. Other records or later entries may exist.'})
                findings.append(make_finding(
                    'unmatched_reversal', 'high' if full_window else 'medium',
                    'Possible reversal not observed' if full_window else 'Reversal observation window incomplete',
                    'No matching reversal is visible in the submitted statement rows. ' +
                    ('At least 14 later calendar days are represented by the statement dates; this does not prove completeness.'
                     if full_window else 'The uploaded rows stop before the full 14-day observation window ends.'),
                    [debit], debit.debit,
                    'Request an official transaction status and reversal confirmation from the bank. Check later statements.', 'low'))

    if len(statements) > 1:
        debit_rows = [(s, tx) for s in statements for tx in s.transactions
                      if tx.debit > 0 and TRANSFER.search(tx.description) and not FAILED.search(tx.description)]
        for origin, debit in sorted(debit_rows, key=lambda pair: (pair[1].date, pair[1].id)):
            descriptor = debit.description.lower()
            named_targets = [s for s in statements if s is not origin and
                             any(re.search(r'\b' + re.escape(token) + r'\b', descriptor)
                                 for token in tokens(s.account))]
            if not named_targets and not SELF.search(descriptor):
                continue
            targets = named_targets or [s for s in statements if s is not origin]
            eligible = [(target, credit) for target in targets for credit in target.transactions
                        if credit.id not in used_credits and credit.credit == debit.debit
                        and abs(days_between(debit, credit)) <= 2]
            ref_matches = [pair for pair in eligible if debit.reference and pair[1].reference and
                           debit.reference.casefold() == pair[1].reference.casefold()]
            if len(ref_matches) == 1:
                eligible = ref_matches
            eligible.sort(key=lambda pair: (abs(days_between(debit, pair[1])), pair[1].date, pair[1].id))
            if len(eligible) == 1:
                target, credit = eligible[0]
                used_credits.add(credit.id)
                transfers.append({'debit_id': debit.id, 'credit_id': credit.id,
                                  'source_account': origin.account, 'target_account': target.account,
                                  'amount': str(debit.debit), 'status': 'possible_match',
                                  'reason': 'Unique unused matching credit within two calendar days; not payment-network confirmation.'})
            elif len(eligible) > 1:
                transfers.append({'debit_id': debit.id, 'credit_id': None,
                                  'source_account': origin.account, 'target_account': None,
                                  'amount': str(debit.debit), 'status': 'ambiguous',
                                  'reason': 'Multiple plausible incoming credits. None automatically assigned.'})
                findings.append(make_finding(
                    'ambiguous_transfer', 'info', 'Multiple possible incoming transfer matches',
                    'More than one credit could correspond to this transfer. A unique cross-account match cannot be established.',
                    [debit], debit.debit, 'Use transaction references and beneficiary confirmation to distinguish candidates.', 'low'))
            else:
                min_date = min((t.date for s in targets for t in s.transactions), default=None)
                max_date = max((t.date for s in targets for t in s.transactions), default=None)
                start = date.fromisoformat(debit.date).toordinal() - 2
                end = date.fromisoformat(debit.date).toordinal() + 2
                complete = (min_date and max_date and date.fromisoformat(min_date).toordinal() <= start
                            and date.fromisoformat(max_date).toordinal() >= end)
                status = 'no_candidate' if complete else 'coverage_limited'
                transfers.append({'debit_id': debit.id, 'credit_id': None,
                                  'source_account': origin.account, 'target_account': None,
                                  'amount': str(debit.debit), 'status': status,
                                  'reason': 'No equal-sized credit in candidate statements. Date boundaries alone do not prove full coverage.'})
                findings.append(make_finding(
                    'unmatched_transfer', 'info',
                    'Incoming transfer not identified in uploads' if complete else 'Transfer review limited by statement dates',
                    'No credit meeting the strict amount/date criteria is present in the other uploaded statements. '
                    + ('Date boundaries cover the two-day window, but rows may still be incomplete.' if complete
                       else 'The other statement dates do not fully bracket the transfer window.'),
                    [debit], debit.debit,
                    'Confirm recipient account, exact transaction reference, and statement coverage before contacting the bank.', 'low'))

    audit = {
        'reversals': reversals,
        'transfers': transfers,
        'possible_reversals': sum(r['status'] == 'possible_reversal' for r in reversals),
        'possible_cross_account_matches': sum(r['status'] == 'possible_match' for r in transfers),
        'explanation': 'One-to-one candidate matches only. No bank APIs, settlement verification, or recipient confirmation.',
    }
    return audit, findings
