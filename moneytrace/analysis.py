"""Deterministic reconciliation. Findings are questions for review, not proof of fraud."""
from __future__ import annotations
from collections import defaultdict
from datetime import date
from decimal import Decimal
import hashlib
import re
from .parsing import Statement, Transaction
from .insights import build_insights

CENT = Decimal("0.01")


def amt(x: Decimal) -> str:
    return f"{x.quantize(CENT):.2f}"


def make_finding(category, severity, title, description, txs, amount, next_step, confidence="medium"):
    key = f"{category}:" + ":".join(sorted(t.id for t in txs))
    return {
        "id": "F-" + hashlib.sha256(key.encode()).hexdigest()[:10].upper(),
        "category": category, "severity": severity, "title": title,
        "description": description, "transaction_ids": [t.id for t in txs],
        "amount": amt(amount), "next_step": next_step,
        "confidence": confidence, "status": "Needs review",
    }


def chronological(items: list[Transaction]):
    if len(items) < 2:
        return items
    ds = [t.date for t in items]
    ascending = sum(a <= b for a,b in zip(ds,ds[1:]))
    descending = sum(a >= b for a,b in zip(ds,ds[1:]))
    # If mixed, don't guess running-balance sequence.
    if ascending < len(items)-1 and descending < len(items)-1:
        return None
    return items if ascending >= descending else list(reversed(items))


def category_of(t: Transaction):
    desc = t.description.lower()
    if any(x in desc for x in ("fee", "charge", "levy", "stamp duty", "vat", "maintenance")):
        return "Bank charges"
    if any(x in desc for x in ("salary", "wages", "payroll")):
        return "Income"
    if any(x in desc for x in ("pos ", "card ", "purchase", "store", "market", "shop")):
        return "Card & POS"
    if any(x in desc for x in ("airtime", "data bundle", "mobile topup")):
        return "Airtime & data"
    if any(x in desc for x in ("bill", "electric", "water", "power", "subscription")):
        return "Bills"
    if "transfer" in desc or "trf" in desc or "received" in desc:
        return "Transfers"
    return "Other"


def normalize_description(s):
    s = re.sub(r"\b(?:ref|rrn|session|id|txn)\s*[:#-]?\s*[a-z0-9-]+", " ", s.lower())
    s = re.sub(r"\d{6,}", " ", s)
    return " ".join(re.findall(r"[a-z]+", s))[:70]


def analyze(statements: list[Statement], generated_at: str) -> dict:
    all_txs = [t for s in statements for t in s.transactions]
    issues, warnings = [], []
    total_debit = sum((t.debit for t in all_txs), Decimal("0"))
    total_credit = sum((t.credit for t in all_txs), Decimal("0"))
    fee_total = sum((t.debit for t in all_txs if category_of(t) == "Bank charges"), Decimal("0"))
    missing_balance = 0
    checked_pairs = 0
    for s in statements:
        warnings.extend(f"{s.filename}: {message}" for message in s.warnings)
        ordered = chronological(s.transactions)
        if ordered is None:
            warnings.append(f"{s.filename}: Transaction order is mixed; running-balance gap checks were skipped rather than assuming a sequence.")
            continue
        missing_balance += sum(t.balance is None for t in ordered)
        for prev, cur in zip(ordered, ordered[1:]):
            if prev.balance is None or cur.balance is None:
                continue
            checked_pairs += 1
            expected = prev.balance + cur.credit - cur.debit
            delta = cur.balance - expected
            if abs(delta) >= CENT:
                issues.append(make_finding(
                    "balance_gap", "high", "Running-balance mismatch",
                    f"Statement {s.filename}: the next recorded balance differs from the arithmetic expectation by ₦{abs(delta):,.2f}. The difference may be a parsing error, omitted entry, or statement inconsistency—not proof of missing funds.",
                    [prev, cur], abs(delta),
                    "Compare both rows against the original bank statement. If amounts are correct, request a transaction-level reconciliation from the bank.", "high" if cur.confidence == "high" else "low",
                ))

    # Duplicate potential: same reference within same account is stronger than similar narration.
    for s in statements:
        seen_refs = {}
        seen_desc = {}
        for t in s.transactions:
            if t.debit <= 0:
                continue
            ref = t.reference.strip().lower()
            if ref and len(ref) >= 5:
                key = (ref, t.debit)
                if key in seen_refs:
                    earlier = seen_refs[key]
                    issues.append(make_finding(
                        "possible_duplicate", "high", "Repeated debit reference",
                        "Two debit rows in the same uploaded statement share a transaction reference and amount. Confirm whether these represent two postings or duplicated statement entries.",
                        [earlier, t], t.debit, "Ask your bank to identify both ledger postings and confirm whether one should be reversed.", "medium",
                    ))
                else:
                    seen_refs[key] = t
            # Even different references may represent inadvertent double charging.
            # Only flag exact same-day same-descriptor debit pairs, at low confidence.
            norm = normalize_description(t.description)
            desc_key = (t.date, t.debit, norm)
            if norm and len(norm) >= 5 and desc_key in seen_desc:
                prior = seen_desc[desc_key]
                if not (ref and len(ref)>=5 and prior.reference.strip().lower()==ref):
                    issues.append(make_finding(
                        "possible_duplicate", "medium", "Similar same-day debits",
                        "Two debits have the same amount and similar descriptions on the same date. Repeated genuine purchases are also possible.",
                        [prior, t], t.debit, "Check merchant receipts and exact payment times before disputing either debit.", "low",
                    ))
            else:
                seen_desc[desc_key] = t

    # Reversal watch: ONLY explicitly failed/pending debit descriptions.
    for s in statements:
        for t in s.transactions:
            if t.debit <= 0 or not re.search(r"\b(failed|unsuccessful|declined)\b", t.description, re.I):
                continue
            candidates = [
                x for x in s.transactions if x.credit == t.debit
                and 0 <= (date.fromisoformat(x.date) - date.fromisoformat(t.date)).days <= 14
                and (bool(t.reference and x.reference and t.reference.lower() == x.reference.lower())
                     or re.search(r"revers|refund|failed", x.description, re.I))
            ]
            if not candidates:
                issues.append(make_finding(
                    "unmatched_reversal", "high", "No matching reversal in uploaded statement",
                    f"A ₦{t.debit:,.2f} debit is labelled failed or declined, but no matching reversal was identified in the uploaded date range.",
                    [t], t.debit,
                    "Check whether the reversal falls outside the statement period or appears under a different reference; contact the bank if still unresolved.", "medium",
                ))

    # Cross-account matching is informative, not an assertion of interbank settlement.
    matched_transfers = 0
    if len(statements) > 1:
        for s in statements:
            other_credits = [x for other in statements if other is not s for x in other.transactions if x.credit > 0]
            for t in s.transactions:
                if t.debit <= 0 or not re.search(r"transfer|\btrf\b", t.description, re.I):
                    continue
                # Compare ONLY transfers explicitly described as between the user's
                # accounts. Payments to third parties aren't expected in other uploads.
                if re.search(r"\b(failed|declined|unsuccessful)\b",t.description,re.I):
                    continue
                known_targets = [other.account.lower().split(' ')[1:-1] for other in statements if other is not s]
                target_tokens = {token for tokens in known_targets for token in tokens if len(token)>3}
                desc_low = t.description.lower()
                if not (re.search(r"\b(self|own|my account|my wallet)\b",desc_low)
                        or any(tok in desc_low for tok in target_tokens)):
                    continue
                candidates = [x for x in other_credits if x.credit == t.debit and abs((date.fromisoformat(x.date)-date.fromisoformat(t.date)).days) <= 2]
                if candidates:
                    matched_transfers += 1
                else:
                    issues.append(make_finding(
                        "unmatched_transfer", "info", "Outgoing transfer not matched across uploads",
                        f"This ₦{t.debit:,.2f} transfer has no equal-sized credit within two days in the OTHER uploaded statements. The recipient could be an outside account.",
                        [t], t.debit,
                        "Only investigate if you expected this payment to arrive in another account you uploaded. Confirm beneficiary and transaction reference.", "low",
                    ))

    spending = defaultdict(lambda: Decimal("0"))
    monthly = defaultdict(lambda: {"debits":Decimal("0"), "credits":Decimal("0")})
    for t in all_txs:
        spending[category_of(t)] += t.debit
        monthly[t.date[:7]]["debits"] += t.debit
        monthly[t.date[:7]]["credits"] += t.credit
    issues.sort(key=lambda f: {"high":0,"medium":1,"info":2}.get(f["severity"],3))
    # Do not sum issue amounts: the same transaction can appear in several findings.
    return {
        "schema_version": "1.1", "generated_at": generated_at,
        "demo": False,
        "summary": {
            "transactions": len(all_txs), "statements": len(statements),
            "debits": amt(total_debit), "credits": amt(total_credit),
            "net_flow": amt(total_credit-total_debit), "charges": amt(fee_total),
            "findings": len(issues), "high_priority": sum(f["severity"]=="high" for f in issues),
            "balance_pairs_checked": checked_pairs, "matched_cross_account_transfers": matched_transfers,
        },
        "statements": [s.serialize() for s in statements],
        "transactions": [dict(t.serialize(), category=category_of(t)) for t in all_txs],
        "findings": issues,
        "analytics": build_insights(all_txs, issues, category_of),
        "categories": [{"label":k,"amount":amt(v)} for k,v in sorted(spending.items(), key=lambda kv:kv[1],reverse=True) if v],
        "months": [{"month":m,"debits":amt(v["debits"]),"credits":amt(v["credits"])} for m,v in sorted(monthly.items())],
        "warnings": warnings,
        "limitations": [
            "This is an automated document review, not bank-ledger authentication or proof of theft.",
            "A valid SHA-256 digest proves byte matching, not that the original statement was authentic.",
            "Flagged transactions may have legitimate explanations. Do not add finding amounts together.",
            "Cross-bank matching uses only the statements supplied; it cannot trace funds through banking networks.",
        ],
    }
