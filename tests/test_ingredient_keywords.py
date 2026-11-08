import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from ingredient_keywords import ingredient_keywords, KEYWORDS


class IngredientKeywordTests(unittest.TestCase):
    def test_custom_aliases(self):
        rules = [{"display": "PDRN", "includes": ["PDRN", "피디알엔", "식물성 PDRN"]}, {"display": "진정", "includes": ["병풀", "시카"]}]
        self.assertEqual(ingredient_keywords("피디알엔, 식물성 pdrn, 병풀추출물", rules), ["PDRN", "진정"])
        self.assertEqual(ingredient_keywords("정제수", rules), [])
        self.assertEqual(ingredient_keywords("PDRN", []), [])
        with self.assertRaises(ValueError):
            ingredient_keywords("PDRN", [{"display": "PDRN", "includes": []}])

    def test_all_keywords_and_corrected_spellings(self):
        self.assertEqual(len(KEYWORDS), 18)
        self.assertEqual(ingredient_keywords(", ".join(KEYWORDS)), KEYWORDS)
        self.assertEqual(ingredient_keywords("엑시좀, 바추이로"), [])

    def test_literal_substrings_unique_and_fixed_order(self):
        self.assertEqual(ingredient_keywords("나이아신아마이드, 세라마이드엔피, 세라마이드엔에스, 아세틸헥사펩타이드-8, pdrn, NAD+"), ["PDRN", "NAD+", "세라마이드", "펩타이드", "나이아신아마이드"])

    def test_no_aliases_or_related_ingredient_inference(self):
        self.assertEqual(ingredient_keywords("병풀추출물, 소듐디엔에이, 아스코빅애씨드, NADP+, 레티닐팔미테이트, 소듐하이알루로네이트"), [])
        self.assertEqual(ingredient_keywords("정제수, 글리세린"), [])
        self.assertIsNone(ingredient_keywords(None))


if __name__ == "__main__":
    unittest.main()
