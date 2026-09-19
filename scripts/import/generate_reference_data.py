"""Regenerate src/js/data/reference.data.js from the reference workbook.

Usage, from the repository root:

    unzip -o -q path/to/ReCore_Reference_Data_*.xlsx -d scripts/import/workbook
    python3 scripts/import/generate_reference_data.py

Kept in the repository so the import is repeatable and reviewable: when the
workbook is reissued, the diff on the generated file shows exactly what moved.
"""
import xlsx_read as read, json, re, pathlib

sheets = dict((n, read.read(p)) for n, p in read.sheets())
def recs(name):
    rows = sheets[name]; hdr = rows[0]
    return [dict(zip(hdr, r + [""] * (len(hdr) - len(r)))) for r in rows[1:]]

def clean(v): return re.sub(r"\s+", " ", (v or "").strip())

def rating(r):
    """Best available published rating, agency named. Never invented."""
    for col, agency in [("S&P Rating", "S&P"), ("AM Best Rating", "AM Best"),
                        ("Moody's Rating", "Moody's"), ("Fitch Rating", "Fitch")]:
        v = clean(r.get(col, ""))
        if v and v.lower() not in ("n/a", "none", "-"):
            return f"{v} ({agency})"
    return "Not rated"

def prune(d):
    return {k: v for k, v in d.items() if v not in ("", None)}

idn, sea = recs("Cedants - Indonesia"), recs("Cedants - Other SEA")
rein, synd = recs("Reinsurers (Global)"), recs("Lloyd's Syndicates")
off, brk = recs("Offshore Reinsurers & Captives"), recs("Local Placement Partners - ID")

is_reinsurer = lambda r: "Reinsurance" in r.get("License Category", "")

# ---- cedants -------------------------------------------------------------
cedants = [prune({
    "name": clean(r["Company Name"]),
    "country": clean(r["Country"]),
    # No KYC has been performed on imported records, and inventing a status
    # would fabricate a compliance position. "Not assessed" blocks the release
    # gate, which is the correct behaviour until onboarding actually happens.
    "kyc": "Not assessed",
    "licenceCategory": clean(r.get("License Category", "")),
    "regulator": clean(r.get("Regulator", "")),
    "ownership": clean(r.get("Ownership Type", "")),
    "notes": clean(r.get("Status", "")) or clean(r.get("Notes", "")),
    "source": "reference",
}) for r in idn + sea if not is_reinsurer(r)]

# ---- reinsurers: global sheet + domestic reinsurers + offshore commercial --
seen, reinsurers = set(), []
def add_reinsurer(name, country, rate, panel, note=""):
    key = name.strip().lower()
    if not name or key in seen: return
    seen.add(key)
    reinsurers.append(prune({
        "name": name, "country": country, "rating": rate, "panel": panel,
        "type": "Reinsurance", "capacity": 0, "notes": note, "source": "reference",
    }))

for r in rein:
    add_reinsurer(clean(r["Company Name"]), clean(r["HQ Country"]), rating(r),
                  clean(r["Region"]), clean(r.get("Type / Notes", "")))
for r in (x for x in idn + sea if is_reinsurer(x)):
    add_reinsurer(clean(r["Company Name"]), clean(r["Country"]), "Not rated",
                  "Domestic reinsurer", clean(r.get("License Category", "")))
for r in off:
    if "Commercial reinsurer" in r.get("Entity Type", ""):
        add_reinsurer(clean(r["Company Name"]), clean(r["Domicile"]), rating(r),
                      "Offshore", clean(r.get("Entity Type", "")))

# ---- Lloyd's syndicates ---------------------------------------------------
syndicates = [prune({
    "name": clean(r["Display Name"]),
    "syndicateNo": clean(r["Syndicate No."]),
    "managingAgent": clean(r["Managing Agent"]),
    # The sheet carries a combined market-level string; take the leading rating.
    "rating": clean(r["Market-Level Rating"].split("/")[0]) or "Not rated",
    "panel": clean(r["Class of Business"]),
    "country": "United Kingdom",
    "type": "Lloyds Syndicate", "capacity": 0, "source": "reference",
}) for r in synd if clean(r["Display Name"])]

# ---- broking partners -----------------------------------------------------
brokers = [prune({
    "name": clean(r["Company Name"]),
    "country": clean(r["Country"]),
    "role": "Reinsurance broker" if "Reasuransi" in r["License Type"] else "Insurance broker",
    "status": "Active",
    "licenceNo": clean(r.get("OJK License No.", "")),
    "notes": clean(r.get("Ownership", "")),
    "source": "reference",
}) for r in brk if clean(r["Company Name"])]
for r in off:
    if "broker" in r.get("Entity Type", "").lower():
        brokers.append(prune({"name": clean(r["Company Name"]), "country": clean(r["Domicile"]),
                              "role": "Insurance broker", "status": "Active",
                              "notes": clean(r.get("Entity Type", "")), "source": "reference"}))

# ---- others: captives and captive managers --------------------------------
others = [prune({
    "name": clean(r["Company Name"]),
    "country": clean(r["Domicile"]),
    "role": clean(r["Entity Type"]),
    "status": "Active",
    "notes": clean(r.get("Notes", ""))[:160],
    "source": "reference",
}) for r in off if "captive" in r.get("Entity Type", "").lower()]

def emit(name, rows):
    body = ",\n".join("  " + json.dumps(r, ensure_ascii=False) for r in rows)
    return f"export const {name} = [\n{body}\n];\n"

header = '''/**
 * Imported reference data — reinsurers, Lloyd's syndicates, offshore carriers,
 * Indonesian broking partners and SEA cedants.
 *
 * GENERATED, DO NOT EDIT BY HAND. Source workbook:
 *   ReCore_Reference_Data_Reinsurers_and_SEA_Cedants.xlsx (compiled 2026-09-18)
 *
 * Routing differs from the workbook's own sheets in three places, because the
 * registry's categories describe what a counterparty may do on a slip:
 *
 *   · Entries in the cedant sheets licensed as "Reinsurance" are domestic
 *     reinsurers, so they are filed under Reinsurance rather than Cedants.
 *   · The offshore sheet is split: commercial reinsurers join Reinsurance,
 *     captives and captive managers go to Others, brokers to Broking Partners.
 *   · Four entities appear in two sheets; the first occurrence wins, since the
 *     registry requires a name to identify exactly one counterparty.
 *
 * Cedants carry kyc "Not assessed". No KYC has been performed on these records,
 * and a status of "Current" would be a fabricated compliance position — so the
 * slip release gate correctly refuses to place for them until onboarding is done.
 */

'''
out = header + "\n".join([
    emit("referenceCedants", cedants),
    emit("referenceReinsurers", reinsurers),
    emit("referenceSyndicates", syndicates),
    emit("referenceBrokers", brokers),
    emit("referenceOthers", others),
])
dest = pathlib.Path("/Users/bindcover/Downloads/Recordes_Reinsurance App_Work/src/js/data/reference.data.js")
dest.write_text(out)
print(f"cedants {len(cedants)} | reinsurers {len(reinsurers)} | syndicates {len(syndicates)} | brokers {len(brokers)} | others {len(others)}")
print("total", len(cedants)+len(reinsurers)+len(syndicates)+len(brokers)+len(others), "records")
print(f"{dest} — {dest.stat().st_size/1024:.0f} KB")
