import importlib.util
import tempfile
import unittest
from pathlib import Path

try:
    import pymupdf
except ImportError:
    pymupdf = None

spec = importlib.util.spec_from_file_location("scholar_document", Path(__file__).parents[1] / "profiles/set-theory/scholar-document.py")
document = importlib.util.module_from_spec(spec)
spec.loader.exec_module(document)

@unittest.skipIf(pymupdf is None, "PyMuPDF is required for real synthetic-PDF coverage tests")
class ScholarCoverage(unittest.TestCase):
    def check_pages(self, count, expected):
        with tempfile.TemporaryDirectory(prefix="qq-scholar-test-") as root:
            path = Path(root) / "synthetic.pdf"
            pdf = pymupdf.open()
            for i in range(count):
                page = pdf.new_page()
                page.insert_text((72, 72), "Synthetic page %d: statement, hypotheses, proof." % (i + 1))
            pdf.save(path)
            pdf.close()
            result = document.extract(path)
            self.assertEqual(result["pageCount"], count)
            self.assertEqual(result["missingRanges"], expected)
            self.assertEqual([p["page"] for p in result["pages"]],
                             list(range(1, count + 1)) if count <= 36 else list(range(1, 25)) + list(range(count - 5, count + 1)))
    def test_short_pdf_is_contiguous(self):
        self.check_pages(12, [])
    def test_long_pdf_exposes_middle_hole(self):
        self.check_pages(48, [[25, 42]])

if __name__ == "__main__":
    unittest.main()
