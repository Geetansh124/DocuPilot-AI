import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from api_server import app
from langraph_rag_backend import _route_with_ruflo, calculator, get_stock_price


class TestBackend(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_api_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_ruflo_route_success(self):
        result = _route_with_ruflo("test task")
        self.assertIn("task", result)
        self.assertEqual(result["task"], "test task")

    @patch("subprocess.run")
    def test_ruflo_route_missing_npx_fallback(self, mock_run):
        mock_run.side_effect = FileNotFoundError("npx not found")
        result = _route_with_ruflo("test fallback")
        self.assertIn("error", result)
        self.assertIn("Ruflo is unavailable", result["error"])

    def test_calculator_tool(self):
        res = calculator.invoke({"first_num": 10, "second_num": 5, "operation": "add"})
        self.assertEqual(res, {"first_num": 10, "second_num": 5, "operation": "add", "result": 15})

        div_zero = calculator.invoke({"first_num": 10, "second_num": 0, "operation": "div"})
        self.assertEqual(div_zero, {"error": "Division by zero is not allowed"})


if __name__ == "__main__":
    unittest.main()
