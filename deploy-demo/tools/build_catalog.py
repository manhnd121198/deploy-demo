#!/usr/bin/env python3
import json
import sys
from pathlib import Path

RAW_BASE_URL = "https://raw.githubusercontent.com/chiefpansancolt/clash-of-clans-data/main/"


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def duration_seconds(value):
    if not isinstance(value, dict):
        return 0
    return (
        to_int(value.get("days")) * 86400
        + to_int(value.get("hours")) * 3600
        + to_int(value.get("minutes")) * 60
        + to_int(value.get("seconds"))
    )


def compact_costs(level):
    costs = {}

    single_fields = (
        ("buildCost", "buildCostResource"),
        ("researchCost", "researchCostResource"),
        ("upgradeCost", "upgradeCostResource"),
    )
    for amount_key, resource_key in single_fields:
        amount = to_int(level.get(amount_key))
        resource = level.get(resource_key)
        if amount > 0 and resource:
            costs[str(resource)] = costs.get(str(resource), 0) + amount

    ore_fields = (
        ("upgradeShinyOre", "Shiny Ore"),
        ("upgradeGlowingOre", "Glowing Ore"),
        ("upgradeStarryOre", "Starry Ore"),
        ("sparkyStones", "Sparky Stones"),
    )
    for amount_key, resource in ore_fields:
        amount = to_int(level.get(amount_key))
        if amount > 0:
            costs[resource] = costs.get(resource, 0) + amount

    return costs


def level_time(level):
    for key in ("buildTime", "researchTime", "upgradeTime"):
        seconds = duration_seconds(level.get(key))
        if seconds > 0:
            return seconds
    return 0


def required_hall(level):
    for source_key, output_key in (
        ("townHallRequired", "townHall"),
        ("builderHallRequired", "builderHall"),
        ("laboratoryRequired", "laboratory"),
        ("heroHallLevelRequired", "heroHall"),
        ("petHouseLevelRequired", "petHouse"),
        ("blacksmithLevelRequired", "blacksmith"),
    ):
        value = to_int(level.get(source_key))
        if value > 0:
            return output_key, value
    return None, 0


def raw_image_url(path):
    if not isinstance(path, str) or not path:
        return ""
    return RAW_BASE_URL + path.lstrip("/")


def first_image(images):
    if not isinstance(images, dict):
        return ""
    for key in ("icon", "normal", "default"):
        url = raw_image_url(images.get(key))
        if url:
            return url
    for value in images.values():
        url = raw_image_url(value)
        if url:
            return url
    return ""


def normalize_levels(raw_levels):
    levels = []
    if not isinstance(raw_levels, list):
        return levels

    for raw_level in raw_levels:
        if not isinstance(raw_level, dict):
            continue
        level = to_int(raw_level.get("level"))
        if level <= 0:
            continue

        costs = compact_costs(raw_level)
        primary_resource, primary_cost = next(iter(costs.items()), ("", 0))
        level_data = {
            "level": level,
            "resource": primary_resource,
            "cost": primary_cost,
            "costs": costs,
            "timeSec": level_time(raw_level),
        }
        image_url = first_image(raw_level.get("images"))
        if image_url:
            level_data["imageUrl"] = image_url
        hall_key, hall_value = required_hall(raw_level)
        if hall_key:
            level_data[hall_key] = hall_value
        levels.append(level_data)

    return levels


def normalize_item(raw, default_kind=None):
    if not isinstance(raw, dict):
        return None
    data_id = raw.get("dataId")
    name = raw.get("name")
    if not isinstance(data_id, int) or not isinstance(name, str):
        return None

    raw_levels = raw.get("levels")
    if raw_levels is None:
        raw_levels = raw.get("upgrades")

    item = {
        "id": str(data_id),
        "name": name,
        "base": raw.get("base", ""),
        "kind": default_kind or raw.get("category", ""),
        "levels": normalize_levels(raw_levels),
    }
    image_url = first_image(raw.get("images"))
    if not image_url and item["levels"]:
        image_url = item["levels"][0].get("imageUrl", "")
    if image_url:
        item["imageUrl"] = image_url
    return item


def add_item(items, item):
    if not item:
        return
    existing = items.get(item["id"])
    if existing and len(existing.get("levels", [])) > len(item.get("levels", [])):
        return
    items[item["id"]] = item


def scan_file(path, data_root, items):
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(raw, dict):
        return

    add_item(items, normalize_item(raw))

    for key in ("modules", "types"):
        nested = raw.get(key)
        if not isinstance(nested, list):
            continue
        for entry in nested:
            item = normalize_item(entry, raw.get("category", ""))
            if item and not item.get("base"):
                item["base"] = raw.get("base", "")
            add_item(items, item)


def main():
    if len(sys.argv) != 3:
        print("usage: build_catalog.py <clash-of-clans-data-root-or-data-dir> <output-json>", file=sys.stderr)
        raise SystemExit(2)

    root = Path(sys.argv[1])
    data_root = root / "data" if (root / "data").is_dir() else root
    output = Path(sys.argv[2])
    if not data_root.is_dir():
        print(f"data directory not found: {data_root}", file=sys.stderr)
        raise SystemExit(1)

    items = {}
    for path in sorted(data_root.rglob("*.json")):
        scan_file(path, data_root, items)

    catalog = {
        "source": "chiefpansancolt/clash-of-clans-data",
        "sourceUrl": "https://github.com/chiefpansancolt/clash-of-clans-data",
        "note": "Generated from modern Clash of Clans JSON data. Unknown IDs are still shown as raw IDs.",
        "items": dict(sorted(items.items(), key=lambda pair: int(pair[0]))),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(items)} items to {output}")


if __name__ == "__main__":
    main()
