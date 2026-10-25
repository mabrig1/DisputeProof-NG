"""Entirely fictional sample statements, clearly marked synthetic."""
from .parsing import parse_file
from .analysis import analyze

SAMPLES = {
 "Demo-Access-Account.csv": """Date,Description,Debit,Credit,Balance,Reference
2026-10-01,Opening balance,0,0,500000,OPENING
2026-10-02,Salary credit,0,250000,750000,SAL1026
2026-10-03,Transfer to own OPay wallet,40000,0,710000,TRF00991
2026-10-04,POS PURCHASE AT MARKET,18500,0,691500,POS00167
2026-10-04,POS PURCHASE AT MARKET,18500,0,673000,POS00168
2026-10-05,FAILED transfer to vendor,25000,0,648000,FAIL0023
2026-10-06,Airtime topup,5000,0,643000,AIR0044
2026-10-06,Account maintenance fee,250,0,642750,CHG004
2026-10-07,Purchase cooking gas,12500,0,628750,GAS001
2026-10-09,Transfer to own Moniepoint wallet,7500,0,621250,TRF01019
""",
 "Demo-OPay-Wallet.csv": """Date,Description,Debit,Credit,Balance,Reference
2026-10-01,Opening balance,0,0,10000,OPENING
2026-10-03,Received transfer from own Access,0,40000,50000,OPC288
2026-10-07,Electricity bill,4500,0,45500,EBILL04
""",
}


def demo(timestamp):
    statements = [parse_file(body.encode(), name, timestamp) for name, body in SAMPLES.items()]
    result = analyze(statements, timestamp)
    result["demo"] = True
    return result
