import unittest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from api_server import app
from langraph_rag_backend import _route_with_ruflo, calculator, get_stock_price, retrieve_all_threads, conn


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

    def test_retrieve_all_threads_performance_and_correctness(self):
        cursor = conn.cursor()
        cursor.execute(
            """CREATE TABLE IF NOT EXISTS checkpoints (
            thread_id TEXT,
            checkpoint_ns TEXT,
            checkpoint_id TEXT,
            parent_checkpoint_id TEXT,
            type TEXT,
            checkpoint BLOB,
            metadata BLOB
        )"""
        )
        cursor.execute("INSERT INTO checkpoints (thread_id) VALUES (?)", ("perf_test_1",))
        cursor.execute("INSERT INTO checkpoints (thread_id) VALUES (?)", ("perf_test_1",))
        cursor.execute("INSERT INTO checkpoints (thread_id) VALUES (?)", ("perf_test_2",))
        conn.commit()

        threads = retrieve_all_threads()
        self.assertIn("perf_test_1", threads)
        self.assertIn("perf_test_2", threads)
        self.assertEqual(len(threads), len(set(threads)))

    def test_agent_python_interpreter(self):
        from agent_tools import python_interpreter
        res = python_interpreter.invoke({"code": "x = 10 * 5\nprint('Computed:', x)"})
        self.assertTrue(res["success"])
        self.assertIn("Computed: 50", res["stdout"])
        self.assertEqual(res["variables"].get("x"), "50")

    def test_agent_get_current_datetime(self):
        from agent_tools import get_current_datetime
        res = get_current_datetime.invoke({})
        self.assertIn("utc_iso", res)
        self.assertIn("year", res)
        self.assertGreaterEqual(res["year"], 2026)

    def test_agent_analyze_tabular_data(self):
        from agent_tools import analyze_tabular_data
        csv_data = "name,score\nAlice,95\nBob,85\nCharlie,90"
        res = analyze_tabular_data.invoke({"data": csv_data})
        self.assertEqual(res["total_rows"], 3)
        self.assertEqual(res["total_columns"], 2)
        self.assertIn("score", res["summary"])
        self.assertEqual(res["summary"]["score"]["max"], 95.0)


if __name__ == "__main__":
    unittest.main()

