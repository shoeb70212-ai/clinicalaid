"""
ClinicFlow — Kaggle Indian Medicine Dataset → master_drugs bulk importer.

Downloads/reads a CSV of Indian medicines and inserts into the Supabase
master_drugs table using the service role key (bypasses RLS).

Usage:
    pip install supabase python-dotenv
    python scripts/import_drugs.py --csv path/to/medicines.csv [--dry-run]

Supported CSV formats (auto-detected by column names):
  1. Kaggle "Indian Medicine Data" (mohneesh7 / similar datasets)
     Columns: name, salt, manufacturer_name, type, price, pack_size_label, short_composition1
  2. GitHub junioralive/Indian-Medicine-Dataset
     Columns: Drug Name, Composition, Uses, Side Effects
  3. Generic / fallback
     Columns: name (or Drug Name), generic_name (or Composition or salt), category (or type)

Environment (.env file at project root or env vars):
    SUPABASE_URL=https://xxxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=eyJ...
"""

import argparse
import csv
import os
import re
import sys
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
except ImportError:
    print("ERROR: python-dotenv not installed. Run: pip install supabase python-dotenv")
    sys.exit(1)

try:
    from supabase import create_client, Client
except ImportError:
    print("ERROR: supabase-py not installed. Run: pip install supabase python-dotenv")
    sys.exit(1)

# ── CDSCO Banned Drug Keywords ─────────────────────────────────────────────
# Fixed-dose combinations banned by CDSCO (not exhaustive — skips obvious ones)
BANNED_KEYWORDS = [
    "ANALGIN", "METAMIZOLE", "NIMESULIDE PAEDIATRIC", "PHENYLPROPANOLAMINE",
    "SIBUTRAMINE", "RIMONABANT", "ROSIGLITAZONE", "CISAPRIDE",
    "OXYPHENBUTAZONE", "PHENACETIN", "NIFEDIPINE SUBLINGUAL",
    "DEXTROPROPOXYPHENE",
]

# Schedule X drugs (cannot be prescribed digitally) — hard block
SCHEDULE_X_KEYWORDS = [
    "MORPHINE", "HEROIN", "COCAINE HYDROCHLORIDE", "CODEINE COMPOUND",
    "AMPHETAMINE", "METHAMPHETAMINE", "BARBITURATE",
]

# ── Column name normalisation ──────────────────────────────────────────────
# Maps various CSV column names → our standard field names
COL_MAP_NAME = ["name", "drug name", "drug_name", "medicine name", "product_name", "brandname"]
COL_MAP_GENERIC = ["generic_name", "salt", "composition", "short_composition1", "uses", "generic"]
COL_MAP_CATEGORY = ["category", "type", "drug_type", "class", "therapeutic_class"]
COL_MAP_SCHEDULE = ["schedule", "drug_schedule"]
COL_MAP_MANUFACTURER = ["manufacturer_name", "manufacturer", "company"]


def normalise_headers(headers: list[str]) -> dict[str, str]:
    """Return a mapping of our field → actual CSV column name."""
    lower = {h.lower().strip(): h for h in headers}
    result: dict[str, str] = {}
    for field, candidates in [
        ("name", COL_MAP_NAME),
        ("generic_name", COL_MAP_GENERIC),
        ("category", COL_MAP_CATEGORY),
        ("schedule", COL_MAP_SCHEDULE),
    ]:
        for c in candidates:
            if c in lower:
                result[field] = lower[c]
                break
    return result


def clean_name(raw: str) -> str:
    """Uppercase, strip extra spaces, remove dosage forms that are too verbose."""
    name = raw.strip().upper()
    # Normalise multiple spaces
    name = re.sub(r"\s{2,}", " ", name)
    return name


def clean_generic(raw: str) -> Optional[str]:
    """Extract first salt/generic from compound strings like 'Paracetamol (500mg) + Ibuprofen'."""
    if not raw:
        return None
    # Take content up to first '+' or '|' separator — first component is enough
    parts = re.split(r"[+|;]", raw)
    generic = parts[0].strip()
    # Remove bracketed dosage: "Amoxicillin (500mg)" → "Amoxicillin"
    generic = re.sub(r"\s*\(.*?\)", "", generic).strip()
    return generic[:200] if generic else None


def infer_schedule(name: str, schedule_col: Optional[str]) -> Optional[str]:
    """Infer schedule from explicit column or name heuristics."""
    if schedule_col:
        s = schedule_col.strip().upper()
        for valid in ["H1", "H", "X", "OTC", "G"]:
            if valid in s:
                return valid
    # Heuristic: narcotics/psychotropics → X
    for kw in SCHEDULE_X_KEYWORDS:
        if kw in name:
            return "X"
    return None


def is_banned(name: str) -> bool:
    for kw in BANNED_KEYWORDS:
        if kw in name:
            return True
    return False


def read_csv(path: str) -> tuple[list[dict], dict[str, str]]:
    """Read CSV and return (rows, col_mapping)."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            print("ERROR: CSV has no header row.")
            sys.exit(1)
        col_map = normalise_headers(list(reader.fieldnames))
        if "name" not in col_map:
            print(f"ERROR: Could not find a drug name column. Found columns: {list(reader.fieldnames)}")
            print("Expected one of: " + ", ".join(COL_MAP_NAME))
            sys.exit(1)
        rows = list(reader)
    print(f"  Read {len(rows):,} rows from CSV")
    return rows, col_map


def transform_rows(rows: list[dict], col_map: dict[str, str]) -> list[dict]:
    """Map CSV rows → master_drugs insert dicts, dedup by name."""
    seen: set[str] = set()
    out: list[dict] = []
    skipped_blank = 0
    skipped_dup = 0

    for row in rows:
        raw_name = row.get(col_map["name"], "").strip()
        if not raw_name:
            skipped_blank += 1
            continue

        name = clean_name(raw_name)
        if not name or len(name) < 3:
            skipped_blank += 1
            continue

        if name in seen:
            skipped_dup += 1
            continue
        seen.add(name)

        raw_generic = row.get(col_map.get("generic_name", ""), "") if "generic_name" in col_map else ""
        raw_category = row.get(col_map.get("category", ""), "") if "category" in col_map else ""
        raw_schedule = row.get(col_map.get("schedule", ""), "") if "schedule" in col_map else ""

        schedule = infer_schedule(name, raw_schedule or None)
        banned = is_banned(name) or schedule == "X"

        out.append({
            "name": name,
            "generic_name": clean_generic(raw_generic),
            "category": raw_category.strip()[:100] if raw_category else None,
            "schedule": schedule,
            "is_banned": banned,
        })

    print(f"  Skipped {skipped_blank:,} blank names, {skipped_dup:,} duplicates")
    print(f"  Prepared {len(out):,} unique drugs for insert")
    return out


def bulk_insert(client: Client, records: list[dict], batch_size: int, dry_run: bool) -> None:
    """Insert records in batches. Uses upsert on name to be idempotent."""
    total = len(records)
    inserted = 0
    errors = 0

    for i in range(0, total, batch_size):
        batch = records[i : i + batch_size]
        batch_num = i // batch_size + 1
        total_batches = (total + batch_size - 1) // batch_size

        print(f"  Batch {batch_num}/{total_batches} ({len(batch)} rows)...", end="", flush=True)

        if dry_run:
            print(" [DRY RUN skipped]")
            inserted += len(batch)
            continue

        try:
            # upsert: if name already exists, update generic_name/category/schedule
            result = (
                client.table("master_drugs")
                .upsert(batch, on_conflict="name")
                .execute()
            )
            inserted += len(batch)
            print(" ok")
        except Exception as e:
            errors += len(batch)
            print(f" ERROR: {e}")

    print(f"\n  Done: {inserted:,} inserted/updated, {errors:,} errors")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Indian medicine CSV → Supabase master_drugs")
    parser.add_argument("--csv", required=True, help="Path to the medicine CSV file")
    parser.add_argument("--batch-size", type=int, default=500, help="Rows per batch (default: 500)")
    parser.add_argument("--dry-run", action="store_true", help="Parse CSV but do not insert into DB")
    args = parser.parse_args()

    # Load env from project root .env
    project_root = Path(__file__).parent.parent
    env_path = project_root / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    else:
        load_dotenv()  # falls back to environment variables

    url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.")
        print("  Create a .env file at the project root with these values.")
        print("  Get SUPABASE_SERVICE_ROLE_KEY from: Supabase Dashboard → Settings → API")
        sys.exit(1)

    if not Path(args.csv).exists():
        print(f"ERROR: CSV file not found: {args.csv}")
        sys.exit(1)

    print(f"\nClinicFlow Drug Importer")
    print(f"  CSV:      {args.csv}")
    print(f"  Target:   {url}")
    print(f"  Dry run:  {args.dry_run}\n")

    print("Step 1: Reading CSV...")
    rows, col_map = read_csv(args.csv)
    print(f"  Column mapping: {col_map}\n")

    print("Step 2: Transforming rows...")
    records = transform_rows(rows, col_map)
    print()

    if not records:
        print("No records to insert. Exiting.")
        sys.exit(0)

    if not args.dry_run:
        client: Client = create_client(url, key)
    else:
        client = None  # type: ignore

    print(f"Step 3: Inserting {len(records):,} records in batches of {args.batch_size}...")
    bulk_insert(client, records, args.batch_size, args.dry_run)

    if not args.dry_run:
        # Verify final count
        try:
            result = client.table("master_drugs").select("id", count="exact").execute()
            count = result.count
            print(f"\nVerification: master_drugs now contains {count:,} rows")
        except Exception as e:
            print(f"\nVerification failed: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
