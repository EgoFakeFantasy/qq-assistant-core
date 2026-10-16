import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
import pymupdf as fitz

spec = importlib.util.spec_from_file_location("import_library", Path(__file__).with_name("import_library.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class ImportLibraryTests(unittest.TestCase):
    def test_nested_pdf_deduplication_and_resumable_ocr(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "source", root / "index"
            (source / "nested").mkdir(parents=True)
            doc = fitz.open()
            page = doc.new_page()
            page.insert_text((50, 80), "Synthetic library fixture. Definition 4. A successor ordinal has cofinality one.")
            page = doc.new_page()
            page.draw_rect(fitz.Rect(50, 50, 100, 100), color=(0, 0, 0))
            doc.set_toc([[1, "4. Ordinal examples", 1]])
            doc.save(source / "fixture.pdf")
            doc.close()
            (source / "nested/copy.pdf").write_bytes((source / "fixture.pdf").read_bytes())
            calls = []
            def ocr(page, destination, engine, language):
                calls.append(1)
                return "Synthetic OCR fixture about ultrafilters and measurable cardinals.", "fixture-ocr"
            result = module.build(source, output, ocr_page=ocr)
            self.assertTrue(result["complete"])
            self.assertEqual(result["pdfFiles"], 2)
            self.assertEqual(result["uniqueBooks"], 1)
            self.assertEqual(result["indexedPages"], 2)
            self.assertEqual(len(calls), 1)
            module.build(source, output, ocr_page=lambda *a: self.fail("OCR must be cached"))
            index = json.loads((output / "pages.json").read_text(encoding="utf-8"))
            self.assertEqual([x["sourceType"] for x in index["pages"]], ["text-layer", "ocr"])
            self.assertFalse(index["pages"][1]["formulaAccuracyVerified"])
            book = json.loads((output / "corpus/manifest.json").read_text(encoding="utf-8"))["books"][0]
            self.assertEqual(len(book["sourceNames"]), 2)
            self.assertEqual(book["pdfToc"][0]["pdfPage"], 1)

    def test_unsupported_files_are_reported_and_not_silently_omitted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source"
            source.mkdir()
            (source / "notes.txt").write_text("synthetic fixture", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "UNSUPPORTED_INPUTS"):
                module.build(source, root / "index")
            report = json.loads((root / "index/inventory.json").read_text(encoding="utf-8"))
            self.assertEqual(report["unsupported"][0]["file"], "notes.txt")
            self.assertFalse(report["complete"])

if __name__ == "__main__":
    unittest.main()
