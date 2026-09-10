"""Build static Japanese search data without changing product display values."""

import argparse
import json
import os
import re
import tempfile
import unicodedata
from pathlib import Path


SEARCH_SCHEMA_VERSION = 1
HAN_PATTERN = re.compile(r"[一-龯々〆ヶ]")


def _katakana_to_hiragana(value):
    converted = []
    for character in value:
        code = ord(character)
        converted.append(chr(code - 0x60) if 0x30A1 <= code <= 0x30F6 else character)
    return "".join(converted)


def normalize_search_text(value):
    normalized = unicodedata.normalize("NFKC", "" if value is None else str(value)).lower()
    return "".join(
        _katakana_to_hiragana(character)
        for character in normalized
        if not character.isspace()
    )


class SudachiReadingEngine:
    def __init__(self):
        try:
            from sudachipy import dictionary, tokenizer
        except ImportError as error:
            raise RuntimeError(
                "search reading generation requires requirements-search.txt"
            ) from error
        self._tokenizer = dictionary.Dictionary().create()
        self._mode = tokenizer.Tokenizer.SplitMode.C

    def tokens(self, value):
        return [
            (morpheme.surface(), morpheme.reading_form(), morpheme.is_oov())
            for morpheme in self._tokenizer.tokenize(value or "", self._mode)
        ]


def _reading(engine, value, aliases, review_items, product_codes):
    readings = []
    for surface, reading, unknown in engine.tokens(value or ""):
        normalized_surface = normalize_search_text(surface)
        normalized_reading = normalize_search_text(reading)
        if not normalized_surface:
            continue
        if re.fullmatch(r"[^\w一-龯々〆ヶぁ-んァ-ヶー]+", normalized_surface):
            continue
        if HAN_PATTERN.search(normalized_surface) and (
            unknown or not normalized_reading or HAN_PATTERN.search(normalized_reading)
        ):
            review_items.append({
                "term": normalized_surface,
                "reason": "unknown_or_unconverted",
                "product_codes": sorted(set(product_codes)),
            })
        if normalized_reading:
            readings.append(normalized_reading)
            if HAN_PATTERN.search(normalized_surface) and normalized_reading != normalized_surface:
                aliases.setdefault(normalized_surface, set()).add(normalized_reading)
    full_surface = normalize_search_text(value)
    full_reading = "".join(readings)
    if full_surface and full_reading and HAN_PATTERN.search(full_surface) and full_surface != full_reading:
        aliases.setdefault(full_surface, set()).add(full_reading)
    return full_reading


def _normalized_synonyms(data):
    aliases = data.get("aliases", {}) if isinstance(data, dict) else {}
    graph = {}
    for source, targets in aliases.items():
        source_key = normalize_search_text(source)
        if not source_key or not isinstance(targets, list):
            continue
        for target in targets:
            target_key = normalize_search_text(target)
            if not target_key or target_key == source_key:
                continue
            graph.setdefault(source_key, set()).add(target_key)
            graph.setdefault(target_key, set()).add(source_key)
    return {key: sorted(values) for key, values in sorted(graph.items())}


def _dedupe_review(items):
    merged = {}
    for item in items:
        key = (item["term"], item["reason"])
        merged.setdefault(key, set()).update(item["product_codes"])
    return [
        {"term": term, "reason": reason, "product_codes": sorted(codes)}
        for (term, reason), codes in sorted(merged.items())
    ]


def build_search_index(products, categories, snapshot_id, synonym_data, engine):
    categories_by_code = {
        str(category.get("SHOHINBUNRUICD")): category
        for category in categories
    }
    products_by_category = {}
    for product in products:
        products_by_category.setdefault(str(product.get("SHOHINBUNRUICD")), []).append(product.get("SHOHINCD"))
    aliases = {}
    review_items = []
    category_terms = {}
    for code, category in categories_by_code.items():
        title = category.get("SHOHINBUNRUITITLE") or ""
        normalized_title = normalize_search_text(title)
        reading = _reading(engine, title, aliases, review_items, products_by_category.get(code, []))
        category_terms[code] = [term for term in (normalized_title, reading) if term]

    entries = {}
    for product in products:
        code = str(product.get("SHOHINCD"))
        name = product.get("SHOHINNM") or ""
        terms = [code, normalize_search_text(name)]
        terms.append(_reading(engine, name, aliases, review_items, [product.get("SHOHINCD")]))
        terms.extend(category_terms.get(str(product.get("SHOHINBUNRUICD")), []))
        entries[code] = {"terms": list(dict.fromkeys(term for term in terms if term))}

    for surface, readings in aliases.items():
        if len(readings) > 1:
            review_items.append({
                "term": surface,
                "reason": "multiple_readings",
                "product_codes": [],
            })
    public_index = {
        "schema_version": SEARCH_SCHEMA_VERSION,
        "snapshot_id": snapshot_id,
        "products": entries,
        "reading_aliases": {
            key: sorted(values) for key, values in sorted(aliases.items())
        },
        "synonyms": _normalized_synonyms(synonym_data),
    }
    review_report = {
        "schema_version": SEARCH_SCHEMA_VERSION,
        "snapshot_id": snapshot_id,
        "items": _dedupe_review(review_items),
    }
    return public_index, review_report


def _write_atomic(path, data, compact=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(
                data,
                handle,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":") if compact else None,
                indent=None if compact else 2,
            )
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, str(path))
    except Exception:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def write_search_files(products, categories, snapshot_id, synonym_data, engine, public_path, review_path):
    public_index, review_report = build_search_index(
        products, categories, snapshot_id, synonym_data, engine
    )
    _write_atomic(public_path, public_index, compact=True)
    _write_atomic(review_path, review_report, compact=False)
    return public_index, review_report


def build_from_catalog(catalog_path, synonym_path, public_path, review_path, engine=None):
    with Path(catalog_path).open(encoding="utf-8") as handle:
        catalog = json.load(handle)
    with Path(synonym_path).open(encoding="utf-8") as handle:
        synonyms = json.load(handle)
    return write_search_files(
        catalog.get("products", []),
        catalog.get("categories", []),
        catalog.get("snapshot_id"),
        synonyms,
        engine or SudachiReadingEngine(),
        public_path,
        review_path,
    )


def main(argv=None):
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=root / "data" / "catalog.json")
    parser.add_argument("--synonyms", type=Path, default=root / "data" / "search-synonyms.json")
    parser.add_argument("--output", type=Path, default=root / "data" / "search-index.json")
    parser.add_argument("--review", type=Path, default=root / "reports" / "search-reading-review.json")
    args = parser.parse_args(argv)
    build_from_catalog(args.catalog, args.synonyms, args.output, args.review)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
