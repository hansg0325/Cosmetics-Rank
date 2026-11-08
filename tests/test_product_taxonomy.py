import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from product_taxonomy import product_top_category


class ProductTaxonomyTests(unittest.TestCase):
    def test_makeup_root(self):
        for path in ("02 > 립 메이크업 > 립케어(컬러립밤)",
                     "02 > 아이 메이크업 > 아이섀도우",
                     "02 > 베이스 메이크업 > 쿠션",
                     "메이크업 > 립메이크업 > 립케어"):
            with self.subTest(path=path):
                self.assertEqual(product_top_category(path), "메이크업")

    def test_other_observed_roots(self):
        for path, expected in (("03 > 퍼퓸 > 향수", "향수/디퓨저"),
                               ("04 > 핸드케어 > 핸드크림", "바디케어"),
                               ("05 > 헤어 트리트먼트 > 헤어오일", "헤어케어")):
            self.assertEqual(product_top_category(path), expected)

    def test_group_01_preserves_distinct_categories(self):
        for category in ("스킨케어", "클렌징", "선케어", "마스크팩"):
            self.assertEqual(product_top_category(f"01 > {category} > 하위분류"), category)

    def test_missing_and_unknown_group(self):
        self.assertEqual(product_top_category(""), "")
        self.assertEqual(product_top_category("02"), "")
        self.assertEqual(product_top_category("99 > 새분류 > 하위"), "새분류")
        self.assertEqual(product_top_category(" 02 >  립 메이크업  > 립케어 "), "메이크업")


if __name__ == "__main__":
    unittest.main()
