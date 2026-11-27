import json
import os
import tempfile
import time
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PAGE = (ROOT / "Matiz.html").as_uri()


class MatizInterface(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        executable = os.environ.get("MATIZ_CHROME") or None
        cls.browser = cls.pw.chromium.launch(executable_path=executable, args=["--no-sandbox"])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def setUp(self):
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 900}, accept_downloads=True)
        self.context.add_init_script("delete window.showSaveFilePicker")
        self.page = self.context.new_page()
        self.errors = []
        self.requests = []
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" else None)
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("request", lambda r: self.requests.append(r.url) if r.url.startswith(("http:", "https:")) else None)
        self.page.goto(PAGE)
        self.wait("document.body.classList.contains('ready')")
        box = self.page.locator("#paper").bounding_box()
        self.origin = (box["x"], box["y"])

    def tearDown(self):
        self.assertEqual(self.errors, [], "erros no console")
        self.assertEqual(self.requests, [], "o Matiz não deve acessar a rede")
        self.context.close()

    def wait(self, code, timeout=10):
        limit = time.monotonic() + timeout
        while time.monotonic() < limit:
            if self.page.evaluate(code):
                return
            self.page.wait_for_timeout(50)
        self.fail(f"tempo esgotado esperando: {code}")

    def drag(self, x0, y0, x1, y1, steps=10, button="left"):
        ox, oy = self.origin
        self.page.mouse.move(ox + x0, oy + y0)
        self.page.mouse.down(button=button)
        self.page.mouse.move(ox + x1, oy + y1, steps=steps)
        self.page.mouse.up(button=button)

    def js(self, code):
        return self.page.evaluate(code)

    def pixel(self, x, y):
        return self.js(f"Array.from(window.matiz.app.paperCtx.getImageData({x}, {y}, 1, 1).data)")

    def tool(self, name):
        self.page.keyboard.press("Escape")
        self.js(f"window.matiz.app.setState('tool', '{name}')")

    def test_csp_and_shell(self):
        csp = self.page.locator('meta[http-equiv="Content-Security-Policy"]').get_attribute("content")
        self.assertIn("connect-src 'none'", csp)
        self.assertIn("object-src 'none'", csp)
        self.assertEqual(self.page.get_by_role("tab", name="Paint").get_attribute("aria-selected"), "true")
        self.assertEqual(self.js("window.matiz.app.doc.width"), 1152)

    def test_pencil_undo_redo(self):
        self.tool("pencil")
        self.drag(10, 10, 100, 10)
        self.assertEqual(self.pixel(50, 10)[:3], [0, 0, 0])
        self.page.keyboard.press("Control+z")
        self.assertEqual(self.pixel(50, 10)[:3], [255, 255, 255])
        self.page.keyboard.press("Control+y")
        self.assertEqual(self.pixel(50, 10)[:3], [0, 0, 0])

    def test_brushes_and_shapes(self):
        brushes = ["brush", "calligraphyBrush", "calligraphyPen", "airbrush", "oil", "crayon", "marker", "pencil", "watercolor"]
        for i, b in enumerate(brushes):
            self.js(f"window.matiz.app.setState('brush', '{b}')")
            self.tool("brush")
            self.drag(30 + i * 60, 40, 60 + i * 60, 120)
        self.js("const a = window.matiz.app; a.setState('fill', 'solid'); a.setState('shape', 'star5')")
        self.tool("shape")
        self.drag(600, 200, 800, 380)
        self.page.keyboard.press("Enter")
        self.assertEqual(self.pixel(700, 300)[:3], [255, 255, 255])
        self.assertGreaterEqual(self.js("window.matiz.app.history.past.length"), 10)

    def test_text_tool(self):
        self.tool("text")
        self.drag(100, 100, 400, 160)
        self.page.keyboard.type("Matiz")
        self.tool("pencil")
        dark = self.js("(() => { const d = window.matiz.app.paperCtx.getImageData(100, 100, 300, 60).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++; return n; })()")
        self.assertGreater(dark, 30)

    def test_object_selection_makes_transparent_png(self):
        self.js("const a = window.matiz.app; a.setColor('secondary', '#ed1c24'); a.setState('fill', 'solid'); a.setState('shape', 'heart')")
        self.tool("shape")
        self.drag(400, 150, 700, 450)
        self.page.keyboard.press("Enter")
        self.js("window.matiz.app.setColor('secondary', '#ffffff')")
        self.tool("objectSelect")
        self.page.get_by_role("button", name="Detectar objeto principal").click()
        self.wait("window.matiz.app.selection && window.matiz.app.selection.object")
        self.page.get_by_role("button", name="Manter só o objeto (fundo transparente)").click()
        self.assertTrue(self.js("window.matiz.app.doc.transparent"))
        self.assertEqual(self.pixel(5, 5)[3], 0)
        self.assertEqual(self.pixel(550, 300)[3], 255)
        edge = self.js("(() => { const d = window.matiz.app.doc.layer.read().data; let soft = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0 && d[i] < 255) soft++; return soft; })()")
        self.assertGreater(edge, 100, "a borda deve ter antialiasing")
        with self.page.expect_download() as info:
            self.js("window.matiz.files.save({ as: 'png' })")
        path = Path(tempfile.mkdtemp()) / "objeto.png"
        info.value.save_as(path)
        data = path.read_bytes()
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(data[25], 6, "PNG com canal alfa")

    def test_project_round_trip(self):
        self.js("window.matiz.app.addLayer()")
        self.tool("pencil")
        self.drag(20, 20, 200, 20)
        with self.page.expect_download() as info:
            self.js("window.matiz.files.save({ as: 'matiz' })")
        path = Path(tempfile.mkdtemp()) / "projeto.matiz"
        info.value.save_as(path)
        project = json.loads(path.read_text())
        self.assertEqual(project["format"], "matiz-paint")
        self.assertEqual(len(project["layers"]), 2)
        self.js("window.matiz.app.markSaved({})")
        with self.page.expect_file_chooser() as chooser:
            self.js("window.matiz.execute('open')")
        chooser.value.set_files(str(path))
        self.wait("window.matiz.app.doc.layers.length === 2")
        self.assertEqual(self.pixel(100, 20)[:3], [0, 0, 0])

    def test_rejects_malicious_project(self):
        path = Path(tempfile.mkdtemp()) / "ruim.matiz"
        path.write_text(json.dumps({"format": "matiz-paint", "version": 1, "name": "<img src=x onerror=alert(1)>", "width": 4, "height": 4, "layers": [{"name": "x", "png": "PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+"}]}))
        with self.page.expect_file_chooser() as chooser:
            self.js("window.matiz.execute('open')")
        chooser.value.set_files(str(path))
        self.page.wait_for_selector(".toast-error")
        self.assertEqual(self.js("window.matiz.app.doc.width"), 1152)

    def test_selection_move_and_transparent_background(self):
        self.js("window.matiz.app.setColor('primary', '#22b14c')")
        self.js("const a = window.matiz.app; a.setState('fill', 'none'); a.setState('shape', 'rectangle')")
        self.tool("shape")
        self.drag(100, 100, 200, 200)
        self.page.keyboard.press("Enter")
        self.tool("select")
        self.drag(90, 90, 210, 210)
        self.drag(150, 150, 450, 150)
        self.page.keyboard.press("Escape")
        self.assertEqual(self.pixel(400, 100)[:3], [34, 177, 76])
        self.js("window.matiz.ops.makeBackgroundTransparent(10)")
        self.assertEqual(self.pixel(20, 20)[3], 0)
        self.assertTrue(self.js("window.matiz.app.doc.transparent"))

    def test_pixel_tab(self):
        self.page.get_by_role("tab", name="Pixel Art").click()
        frame = self.page.frame_locator("#pixel-frame")
        frame.get_by_role("button", name="Agora não").click()
        canvas = frame.locator("#viewport").bounding_box()
        cx = canvas["x"] + canvas["width"] / 2
        cy = canvas["y"] + canvas["height"] / 2
        self.page.mouse.move(cx, cy)
        self.page.mouse.down()
        self.page.mouse.move(cx + 80, cy + 40, steps=8)
        self.page.mouse.up()
        history = self.page.evaluate("document.getElementById('pixel-frame').contentWindow.matizPixel.editor.history.past.length")
        self.assertEqual(history, 1)
        self.assertEqual(frame.locator(".timeline").count(), 0, "a aba Pixel Art não tem linha do tempo")
        menus = frame.locator(".menu-button").all_inner_texts()
        self.assertNotIn("Quadro", menus)
        frame.locator("#theme").click()
        self.wait("document.documentElement.dataset.theme === 'dark'")
        frame.get_by_role("tab", name="Paint").click()
        self.assertFalse(self.page.locator("#paint").is_hidden())


if __name__ == "__main__":
    unittest.main()
