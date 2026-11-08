"""Literal keyword matches in the ingredient disclosure only, without aliases."""
import json
import os
from pathlib import Path

KEYWORDS = json.loads((Path(__file__).resolve().parent.parent / "src/shared/ingredientKeywords.json").read_text(encoding="utf-8"))


def default_rules():
    return [{"display": word, "includes": [word, "피디알엔", "식물성 PDRN"] if word == "PDRN" else [word]} for word in KEYWORDS]


def validate_rules(rules):
    if not isinstance(rules, list) or len(rules) > 100:
        raise ValueError("키워드 규칙 오류입니다.")
    displays = set()
    for rule in rules:
        if not isinstance(rule, dict) or set(rule) != {"display", "includes"}:
            raise ValueError("키워드 규칙 오류입니다.")
        if not isinstance(rule["includes"], list) or not 1 <= len(rule["includes"]) <= 30:
            raise ValueError("키워드 규칙 오류입니다.")
        for word in [rule["display"], *rule["includes"]]:
            if not isinstance(word, str) or not 1 <= len(word.strip()) <= 100 or word != word.strip() or any(c in word for c in ",\r\n"):
                raise ValueError("키워드 규칙 오류입니다.")
        if rule["display"].casefold() in displays:
            raise ValueError("표시할 단어가 중복됩니다.")
        displays.add(rule["display"].casefold())
    return rules


def ingredient_keywords(ingredients, rules=None):
    if ingredients is None:
        return None
    text = ingredients.casefold()
    if rules is None:
        rules = json.loads(os.environ["COSMETICS_RANK_KEYWORD_RULES"]) if "COSMETICS_RANK_KEYWORD_RULES" in os.environ else default_rules()
    return [rule["display"] for rule in validate_rules(rules) if any(word.casefold() in text for word in rule["includes"])]
