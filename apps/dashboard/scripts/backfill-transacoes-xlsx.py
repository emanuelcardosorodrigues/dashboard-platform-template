#!/usr/bin/env python3

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from urllib import error, parse, request

import openpyxl


DEFAULT_XLSX_PATH = "/Users/usuario-exemplo/Downloads/LST_Dashboard_Enhanced.xlsx"
DEFAULT_ENV_PATH = "/Users/usuario-exemplo/Projects/dashboard-app/.env.local"
SHEET_NAME = "TODAS AS TRANSAÇÕES"
CUTOFF_DATE = date(2026, 4, 1)
BATCH_SIZE = 500


def load_env(path: str) -> None:
    for raw_line in Path(path).read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key.strip(), value)


def parse_money(value) -> float:
    if value in (None, ""):
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    text = text.replace("R$", "").replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def parse_int(value) -> int:
    if value in (None, ""):
        return 0
    try:
        return int(float(str(value).replace(",", ".")))
    except ValueError:
        return 0


def parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    text = str(value).strip()
    try:
        if "/" in text:
            day, month, year = text.split("/")
            return date(int(year), int(month), int(day))
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def parse_bool(value) -> bool:
    text = str(value or "").strip().lower()
    return text in {"sim", "true", "1", "yes"}


def choose_criativo(row, idx) -> str:
    normalized = str(row[idx["CRIATIVO_NORMALIZADO"]] or "").strip()
    if normalized:
        return normalized

    ultimo_content = str(row[idx["ÚLTIMO IMPACTO utm_content"]] or "").strip()
    if ultimo_content:
        return ultimo_content

    ultimo_campaign = str(row[idx["ÚLTIMO IMPACTO utm_campaign"]] or "").strip()
    return ultimo_campaign


def build_records(xlsx_path: str):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    ws = wb[SHEET_NAME]
    headers = [c for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True))]
    idx = {header: i for i, header in enumerate(headers) if header}
    records = []

    for row in ws.iter_rows(min_row=2, values_only=True):
        hotmart_id = str(row[idx["ID"]] or "").strip()
        data_compra = parse_date(row[idx["Data"]])
        valor_bruto = parse_money(row[idx["Valor Bruto"]])

        if not hotmart_id or not data_compra or data_compra > CUTOFF_DATE or valor_bruto <= 1:
            continue

        records.append(
            {
                "hotmart_id": hotmart_id,
                "data": data_compra.isoformat(),
                "nome": str(row[idx["Nome"]] or "").strip(),
                "email": str(row[idx["E-mail"]] or "").strip().lower(),
                "produto": str(row[idx["Produto"]] or "").strip(),
                "valor_bruto": valor_bruto,
                "valor_liquido_expert": parse_money(row[idx["Valor Líquido (Expert)"]]),
                "forma_pagamento": str(row[idx["Forma de Pagamento"]] or "").strip(),
                "parcelas": max(parse_int(row[idx["Quantidade de parcelas"]]), 1),
                "criativo": choose_criativo(row, idx),
                "utm_medium_ultimo": str(row[idx["ÚLTIMO IMPACTO Utm_medium"]] or "").strip(),
                "utm_source_ultimo": str(row[idx["ÚLTIMO IMPACTO utm_source"]] or "").strip(),
                "utm_medium_primeiro": str(row[idx["PRIMEIRO IMPACTO Utm_medium"]] or "").strip(),
                "utm_source_primeiro": str(row[idx["PRIMEIRO IMPACTO utm_source"]] or "").strip(),
            }
        )

    return records


def upsert_batch(records):
    supabase_url = os.environ["SUPABASE_URL"].rstrip("/")
    service_role_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = (
        f"{supabase_url}/rest/v1/transacoes"
        f"?on_conflict={parse.quote('hotmart_id')}"
    )
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    inserted = 0
    for start in range(0, len(records), BATCH_SIZE):
        batch = records[start : start + BATCH_SIZE]
        payload = json.dumps(batch).encode("utf-8")
        req = request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with request.urlopen(req) as response:
                if response.status not in (200, 201, 204):
                    raise RuntimeError(f"HTTP {response.status}")
        except error.HTTPError as exc:
            body = exc.read().decode("utf-8", "ignore")
            raise RuntimeError(f"Erro HTTP {exc.code}: {body}") from exc
        inserted += len(batch)
        print(f"   ✅ {inserted}/{len(records)} upserts")


def main():
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX_PATH
    env_path = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_ENV_PATH

    load_env(env_path)
    records = build_records(xlsx_path)
    print(f"📥 {len(records)} transações históricas até {CUTOFF_DATE.isoformat()} prontas para upsert")
    upsert_batch(records)
    print("✅ Backfill concluído")


if __name__ == "__main__":
    main()
