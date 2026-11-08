import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from manufacturer_info import split_manufacturer_seller


class ManufacturerTests(unittest.TestCase):
    def test_first_slash(self):
        self.assertEqual(split_manufacturer_seller("(주)코스비전/(주)아모레퍼시픽"), ("(주)코스비전", "(주)아모레퍼시픽"))
        self.assertEqual(split_manufacturer_seller(" 제조사 / 판매업자 / 추가 판매업자 "), ("제조사", "판매업자 / 추가 판매업자"))

    def test_missing_separator_is_not_guessed(self):
        self.assertEqual(split_manufacturer_seller("제조사와 판매업자"), (None, None))
        self.assertEqual(split_manufacturer_seller(None), (None, None))
        self.assertEqual(split_manufacturer_seller("/ 판매업자"), (None, "판매업자"))


if __name__ == "__main__":
    unittest.main()
