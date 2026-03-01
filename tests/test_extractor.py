"""Tests for table_deps.extractor.extract_tables."""

import pytest
from table_deps.extractor import extract_tables


# ---------------------------------------------------------------------------
# Basic SELECT queries
# ---------------------------------------------------------------------------
class TestBasicSelect:
    def test_simple_from(self):
        assert extract_tables("SELECT * FROM orders") == ["orders"]

    def test_case_insensitive_keyword(self):
        assert extract_tables("select * from orders") == ["orders"]

    def test_aliased_table(self):
        assert extract_tables("SELECT o.id FROM orders o") == ["orders"]

    def test_returns_sorted_list(self):
        sql = "SELECT * FROM zzz JOIN aaa ON zzz.id = aaa.id"
        result = extract_tables(sql)
        assert result == sorted(result)

    def test_deduplicates_same_table(self):
        sql = "SELECT * FROM orders o1 JOIN orders o2 ON o1.parent_id = o2.id"
        assert extract_tables(sql) == ["orders"]

    def test_no_tables_returns_empty(self):
        assert extract_tables("SELECT 1 + 1") == []


# ---------------------------------------------------------------------------
# JOIN variants
# ---------------------------------------------------------------------------
class TestJoins:
    def test_inner_join(self):
        sql = "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id"
        assert extract_tables(sql) == ["customers", "orders"]

    def test_left_join(self):
        sql = "SELECT * FROM orders LEFT JOIN customers ON orders.customer_id = customers.id"
        assert extract_tables(sql) == ["customers", "orders"]

    def test_multiple_joins(self):
        sql = """
            SELECT o.id, c.name, p.title
            FROM orders o
            JOIN customers c ON o.customer_id = c.id
            LEFT JOIN products p ON o.product_id = p.id
        """
        assert extract_tables(sql) == ["customers", "orders", "products"]

    def test_cross_join(self):
        sql = "SELECT * FROM a CROSS JOIN b"
        assert extract_tables(sql) == ["a", "b"]


# ---------------------------------------------------------------------------
# Schema-qualified names
# ---------------------------------------------------------------------------
class TestSchemaQualified:
    def test_two_part_name(self):
        assert extract_tables("SELECT * FROM public.orders") == ["public.orders"]

    def test_three_part_name(self):
        assert extract_tables("SELECT * FROM db.public.orders") == ["db.public.orders"]

    def test_schema_qualified_join(self):
        sql = "SELECT * FROM public.orders JOIN public.customers ON orders.id = customers.id"
        assert extract_tables(sql) == ["public.customers", "public.orders"]


# ---------------------------------------------------------------------------
# CTEs (Common Table Expressions)
# ---------------------------------------------------------------------------
class TestCTEs:
    def test_single_cte_excluded(self):
        sql = """
            WITH ranked AS (SELECT * FROM employees)
            SELECT * FROM ranked
        """
        assert extract_tables(sql) == ["employees"]

    def test_multiple_ctes_excluded(self):
        sql = """
            WITH
                a AS (SELECT * FROM t1),
                b AS (SELECT * FROM t2)
            SELECT * FROM a JOIN b ON a.id = b.id
        """
        assert extract_tables(sql) == ["t1", "t2"]

    def test_recursive_cte(self):
        sql = """
            WITH RECURSIVE tree AS (
                SELECT id, parent_id FROM categories WHERE parent_id IS NULL
                UNION ALL
                SELECT c.id, c.parent_id FROM categories c JOIN tree t ON c.parent_id = t.id
            )
            SELECT * FROM tree
        """
        assert extract_tables(sql) == ["categories"]


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------
class TestComments:
    def test_single_line_comment_ignored(self):
        assert extract_tables("SELECT * FROM orders -- get all orders") == ["orders"]

    def test_block_comment_ignored(self):
        assert extract_tables("SELECT * FROM /* main table */ orders") == ["orders"]

    def test_table_in_comment_not_extracted(self):
        sql = "-- SELECT * FROM fake_table\nSELECT * FROM real_table"
        assert extract_tables(sql) == ["real_table"]

    def test_multiline_block_comment(self):
        sql = """
            /*
             * Author: test
             * FROM fake_table
             */
            SELECT * FROM real_table
        """
        assert extract_tables(sql) == ["real_table"]


# ---------------------------------------------------------------------------
# String literals
# ---------------------------------------------------------------------------
class TestStringLiterals:
    def test_table_name_in_string_ignored(self):
        sql = "SELECT 'FROM fake_table' FROM real_table"
        assert extract_tables(sql) == ["real_table"]

    def test_escaped_quote_in_string(self):
        sql = "SELECT 'it\\'s fine' FROM real_table"
        assert extract_tables(sql) == ["real_table"]


# ---------------------------------------------------------------------------
# DML statements
# ---------------------------------------------------------------------------
class TestDML:
    def test_insert_into(self):
        assert extract_tables("INSERT INTO orders (id) VALUES (1)") == ["orders"]

    def test_update(self):
        assert extract_tables("UPDATE customers SET name = 'Alice' WHERE id = 1") == ["customers"]

    def test_delete_from(self):
        assert extract_tables("DELETE FROM orders WHERE id = 1") == ["orders"]

    def test_insert_select(self):
        sql = "INSERT INTO archive SELECT * FROM orders WHERE created_at < '2024-01-01'"
        assert extract_tables(sql) == ["archive", "orders"]


# ---------------------------------------------------------------------------
# Quoted identifiers
# ---------------------------------------------------------------------------
class TestQuotedIdentifiers:
    def test_backtick_quoted(self):
        assert extract_tables("SELECT * FROM `my_table`") == ["my_table"]

    def test_double_quoted(self):
        assert extract_tables('SELECT * FROM "my_table"') == ["my_table"]

    def test_backtick_schema_qualified(self):
        assert extract_tables("SELECT * FROM `mydb`.`orders`") == ["mydb.orders"]


# ---------------------------------------------------------------------------
# Subqueries and set operations
# ---------------------------------------------------------------------------
class TestSubqueriesAndSetOps:
    def test_subquery_in_from(self):
        sql = "SELECT * FROM (SELECT * FROM inner_table) t"
        assert extract_tables(sql) == ["inner_table"]

    def test_union(self):
        sql = "SELECT * FROM table_a UNION ALL SELECT * FROM table_b"
        assert extract_tables(sql) == ["table_a", "table_b"]

    def test_correlated_subquery_in_where(self):
        sql = """
            SELECT * FROM orders o
            WHERE EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
        """
        assert extract_tables(sql) == ["order_items", "orders"]


# ---------------------------------------------------------------------------
# Edge cases / validation
# ---------------------------------------------------------------------------
class TestEdgeCases:
    def test_empty_string_raises(self):
        with pytest.raises(ValueError, match="empty"):
            extract_tables("")

    def test_whitespace_only_raises(self):
        with pytest.raises(ValueError, match="empty"):
            extract_tables("   \n\t  ")

    def test_multiline_query(self):
        sql = """
            SELECT
                o.id,
                c.name
            FROM
                orders o
            JOIN
                customers c ON o.customer_id = c.id
        """
        assert extract_tables(sql) == ["customers", "orders"]

    def test_keyword_not_extracted_as_table(self):
        # LATERAL is a keyword; only real_table should appear
        sql = "SELECT * FROM real_table LATERAL JOIN (SELECT 1) t ON true"
        assert "lateral" not in extract_tables(sql)
        assert "real_table" in extract_tables(sql)
