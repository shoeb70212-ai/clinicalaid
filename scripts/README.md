# ClinicFlow — Data Scripts

## Drug Database Import (`import_drugs.py`)

One-time script to populate `master_drugs` from a free Indian medicine CSV dataset.
Run this once when setting up a new Supabase project before onboarding any doctors.

---

### Step 1: Download the dataset

**Option A — Kaggle (recommended, ~250k drugs)**

1. Create a free account at [kaggle.com](https://www.kaggle.com)
2. Search for **"Indian Medicine Data"** or go directly to one of these datasets:
   - `https://www.kaggle.com/datasets/mohneesh7/indian-medicine-data`
   - `https://www.kaggle.com/datasets/shudhanshusingh/az-medicine-dataset-of-india`
3. Download the CSV file (usually `medicines.csv` or `A_Z_medicines_dataset_of_India.csv`)

**Option B — GitHub (smaller, ~18k drugs, no signup needed)**

```bash
curl -L https://raw.githubusercontent.com/junioralive/Indian-Medicine-Dataset/main/data/medicine_data.json \
  -o medicine_data.json
# Then convert JSON → CSV manually or use the json variant of this script (coming in V2)
```

**Option C — Use the CSV directly from your local file**

If your clinic already has a drug list in Excel format, export it as CSV with these columns:
- `name` or `Drug Name` — brand name of the medicine
- `salt` or `Composition` — generic/salt name
- `type` or `category` — therapeutic category (optional)

---

### Step 2: Set up environment

Ensure your `.env` file at the project root has:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...
```

Get `SUPABASE_SERVICE_ROLE_KEY` from:
**Supabase Dashboard → Settings → API → Service role secret**

> ⚠️ The service role key bypasses RLS. Never commit it to git. Never expose it client-side.

---

### Step 3: Install dependencies

```bash
pip install supabase python-dotenv
```

---

### Step 4: Run a dry run first

```bash
cd /path/to/project   # replace with your actual project root
python scripts/import_drugs.py --csv path/to/medicines.csv --dry-run
```

This parses the CSV, shows column mapping and row count, but does **not** insert anything.
Verify the output looks correct before proceeding.

---

### Step 5: Run the actual import

```bash
python scripts/import_drugs.py --csv path/to/medicines.csv
```

The script will:
1. Read the CSV and auto-detect column names
2. Normalise drug names to UPPERCASE (NMC mandate)
3. Skip duplicates and blank rows
4. Flag known CDSCO-banned drugs as `is_banned = TRUE`
5. Insert in batches of 500 rows
6. Print a final row count for verification

---

### Expected output

```
ClinicFlow Drug Importer
  CSV:      medicines.csv
  Target:   https://xxxxx.supabase.co
  Dry run:  False

Step 1: Reading CSV...
  Read 248,321 rows from CSV
  Column mapping: {'name': 'name', 'generic_name': 'salt', 'category': 'type'}

Step 2: Transforming rows...
  Skipped 1,204 blank names, 18,432 duplicates
  Prepared 228,685 unique drugs for insert

Step 3: Inserting 228,685 records in batches of 500...
  Batch 1/458 (500 rows)... ok
  ...
  Done: 228,685 inserted/updated, 0 errors

Verification: master_drugs now contains 228,685 rows

Done.
```

---

### Troubleshooting

| Error | Fix |
|-------|-----|
| `Could not find a drug name column` | Check your CSV has a column named `name`, `Drug Name`, or `drug_name` |
| `Missing SUPABASE_SERVICE_ROLE_KEY` | Add it to your `.env` file (not `VITE_` prefix) |
| `permission denied for table master_drugs` | You used `VITE_SUPABASE_ANON_KEY` — use `SUPABASE_SERVICE_ROLE_KEY` instead |
| Script is slow | Reduce `--batch-size` to 200, or increase to 1000 if connection is stable |

---

### Re-running (idempotent)

The script uses `upsert` — safe to run multiple times. Duplicate drug names are updated
(not duplicated). Run again whenever you download an updated CSV.

---

### V2 — Automated nightly sync

In V2, this will be replaced by a Supabase Edge Function that:
1. Pulls from a licensed Indian formulary API (1MG Partner / Pharmarack B2B)
2. Updates `master_drugs` nightly
3. Applies state-based availability filtering using `clinics.state`
