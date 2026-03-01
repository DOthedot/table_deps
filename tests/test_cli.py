"""Tests for table_deps.cli."""

import json
from unittest.mock import mock_open, patch

import pytest
from table_deps.cli import main


class TestCLIInline:
    def test_plain_output(self, capsys):
        exit_code = main(["SELECT * FROM orders"])
        assert exit_code == 0
        out = capsys.readouterr().out
        assert "orders" in out

    def test_json_output(self, capsys):
        exit_code = main(["SELECT * FROM orders", "--output-format", "json"])
        assert exit_code == 0
        data = json.loads(capsys.readouterr().out)
        assert data == {"tables": ["orders"]}

    def test_csv_output(self, capsys):
        exit_code = main(["SELECT * FROM a JOIN b ON a.id = b.id", "-o", "csv"])
        assert exit_code == 0
        out = capsys.readouterr().out.strip()
        assert set(out.split(",")) == {"a", "b"}

    def test_no_tables_message(self, capsys):
        exit_code = main(["SELECT 1"])
        assert exit_code == 0
        assert "No tables found" in capsys.readouterr().out

    def test_empty_sql_error(self, capsys):
        exit_code = main(["   "])
        assert exit_code == 1
        assert capsys.readouterr().err != ""


class TestCLIFile:
    def test_reads_from_file(self, capsys, tmp_path):
        sql_file = tmp_path / "query.sql"
        sql_file.write_text("SELECT * FROM file_table")
        exit_code = main(["--file", str(sql_file)])
        assert exit_code == 0
        assert "file_table" in capsys.readouterr().out

    def test_missing_file_returns_error(self, capsys):
        exit_code = main(["--file", "/nonexistent/path/query.sql"])
        assert exit_code == 1
        assert capsys.readouterr().err != ""


class TestCLIStdin:
    def test_reads_from_stdin(self, capsys, monkeypatch):
        import io
        monkeypatch.setattr("sys.stdin", io.StringIO("SELECT * FROM stdin_table"))
        monkeypatch.setattr("sys.stdin.isatty", lambda: False)
        exit_code = main([])
        assert exit_code == 0
        assert "stdin_table" in capsys.readouterr().out
