# Reference data import

`src/js/data/reference.data.js` is generated, not hand-edited. To regenerate it
after the workbook is reissued:

```bash
unzip -o -q ~/Downloads/ReCore_Reference_Data_Reinsurers_and_SEA_Cedants.xlsx \
  -d scripts/import/workbook
python3 scripts/import/generate_reference_data.py
```

The workbook itself is not committed — only the generated JavaScript, so the
diff shows what actually changed in the data.

## Routing

The workbook's sheets do not map one-to-one onto the registry's categories,
because a category here describes what a counterparty may do on a slip:

| Workbook sheet | Registry category |
|---|---|
| Cedants – Indonesia / Other SEA | **Cedants**, except entries licensed as `Reinsurance` |
| … those `Reinsurance` entries | **Reinsurance** (they are domestic reinsurers) |
| Reinsurers (Global) | **Reinsurance** |
| Lloyd's Syndicates | **Lloyd's Syndicates** |
| Offshore Reinsurers & Captives | split: commercial reinsurers → **Reinsurance**, captives and captive managers → **Others**, brokers → **Reinsurance Brokers** |
| Local Placement Partners – ID | **Reinsurance Brokers** |
| Countries – Reinsurer Coverage | not imported — reference material, not counterparties |

Four entities appear in two sheets; the first occurrence wins, because the
registry requires a name to identify exactly one counterparty.

## KYC

Imported cedants carry `kyc: "Not assessed"`. No KYC has been performed on them
and a status of `Current` would be a fabricated compliance position, so the slip
release gate correctly refuses to place for them until somebody onboards them.
