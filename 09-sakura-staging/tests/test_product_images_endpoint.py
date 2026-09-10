import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
ENDPOINT = ROOT / "data" / "product-images.php"


class ProductImagesEndpointContractTest(unittest.TestCase):
    def test_endpoint_is_select_only_and_returns_no_private_metadata(self):
        source = ENDPOINT.read_text(encoding="ascii")
        self.assertIn("MT_GAZO_ADDITIONAL", source)
        self.assertIn("KOKAI_FLG", source)
        self.assertIn("ASSET_STATE", source)
        self.assertRegex(source, r"SELECT[\s\S]+FROM MT_GAZO_ADDITIONAL")
        self.assertNotRegex(source, r"\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b")
        self.assertNotIn("SHA256\"", source)
        self.assertNotIn("METADATA_VERSION\"", source)
        self.assertNotIn("OPERATION_ID\"", source)

    def test_endpoint_validates_requested_product_and_public_files(self):
        source = ENDPOINT.read_text(encoding="ascii")
        self.assertIn("/^[0-9]{1,4}$/", source)
        self.assertIn("/home/nano87/www/webcart/additional-images", source)
        self.assertIn("hash_file('sha256'", source)
        self.assertIn("KOKAI_FLG'] !== '1'", source)
        self.assertIn("count($rows) >= 5", source)
        self.assertIn("https://nano87.com/webcart/additional-images/", source)

    def test_endpoint_never_guesses_a_four_digit_product_from_a_five_digit_code(self):
        source = ENDPOINT.read_text(encoding="ascii")
        self.assertNotIn("% 10000", source)
        self.assertNotIn("FROM MT_SHOHIN", source)
        self.assertNotIn("nanohana_images_canonical_code", source)

    def test_endpoint_fail_closes_without_exposing_errors(self):
        source = ENDPOINT.read_text(encoding="ascii")
        self.assertIn("display_errors', '0'", source)
        self.assertIn("product' => null", source)
        self.assertNotRegex(source, r"mysql_error|mysqli_error|PDOException")
        self.assertNotRegex(source, r"echo\s+\$[A-Za-z_][A-Za-z0-9_]*")


if __name__ == "__main__":
    unittest.main()
