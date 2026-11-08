"""Resolve ranking-card taxonomy paths to product top-level categories.

The site's 01 group contains skincare, cleansing, suncare and masks, so it
must keep its first named category. Other observed groups encode the root
as a number and start their names at the second level.
"""
ROOT_GROUPS = {
    "02": "메이크업",
    "03": "향수/디퓨저",
    "04": "바디케어",
    "05": "헤어케어",
}


def product_top_category(path):
    parts = [part.strip() for part in path.split(">") if part.strip()]
    if not parts:
        return ""
    names = [part for part in parts if not part.isdecimal()]
    if not names:
        return ""
    if parts[0] in ROOT_GROUPS:
        return ROOT_GROUPS[parts[0]]
    return names[0]
