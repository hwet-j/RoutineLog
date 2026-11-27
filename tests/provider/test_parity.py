"""RoutineSql.kt 의 SQL 이 routine.py(=docs/provider-sql.md)와 공백 차이를 빼고 같은지 확인한다 (Kotlin 을 실행할 수 없어서 하는 안전장치)."""
import os
import re
import unittest

from . import routine as R

KT = os.path.join(os.path.dirname(__file__), "..", "..", "modules", "assistant-share", "android", "src", "main", "java",
                  "expo", "modules", "assistantshare", "RoutineSql.kt")

MAP = {
    "ROUTINES": "SQL_ROUTINES", "ROUTINES_LITE": "SQL_ROUTINES_LITE", "TIMES": "SQL_TIMES", "TIMES_FOR": "SQL_TIMES_FOR",
    "LOG_SELECT": "SQL_LOG_SELECT", "LOG_BY_ID": "SQL_LOG_BY_ID", "LOG_BY_REF": "SQL_LOG_BY_REF", "LOG_SLOT": "SQL_LOG_SLOT",
    "LOG_NOSLOT": "SQL_LOG_NOSLOT", "SLOTS_USED": "SQL_SLOTS_USED", "INSERT": "SQL_INSERT", "DELETE": "SQL_DELETE",
    "PROGRESS_COUNT": "SQL_PROGRESS_COUNT", "PROGRESS_SUM": "SQL_PROGRESS_SUM", "ROUTINE_BY_ID": "SQL_ROUTINE_BY_ID", "KV": "SQL_KV",
}


def squash(s):
    return re.sub(r"\s+", " ", s).strip()


def parse_consts(src):
    consts = {}
    for m in re.finditer(r'const val (\w+) = (.*?)(?=\n  (?:const val|fun|/\*\*)|\n\})', src, re.S):
        consts[m.group(1)] = m.group(2).strip()
    return consts


def evaluate(expr, consts):
    def lit(tok):
        tok = tok.strip()
        if tok.startswith('"""'):
            return tok[3:-3]
        if tok.startswith('"'):
            return tok[1:-1]
        return evaluate(consts[tok], consts)
    parts = re.findall(r'"""(?:.|\n)*?"""|"[^"\n]*"|\w+', expr)
    text = "".join(lit(p) for p in parts)
    return re.sub(r"\$\{?(\w+)\}?", lambda m: evaluate(consts[m.group(1)], consts) if m.group(1) in consts else m.group(0), text)


class Parity(unittest.TestCase):
    def test_sql_matches_python_reference(self):
        src = open(KT, encoding="utf-8").read()
        consts = parse_consts(src)
        for kt, py in MAP.items():
            self.assertIn(kt, consts, kt)
            self.assertEqual(squash(evaluate(consts[kt], consts)), squash(getattr(R, py)), kt)

    def test_every_python_sql_constant_is_mapped(self):
        names = {n for n in dir(R) if n.startswith("SQL_")}
        self.assertEqual(names - set(MAP.values()) - {"SQL_LOG_RANGE"}, set())

    def test_range_query(self):
        src = open(KT, encoding="utf-8").read()
        m = re.search(r'fun logRange\(limit: Int\) = (.*?)\n\n', src, re.S)
        text = evaluate(m.group(1), parse_consts(src)).replace("$limit", "?")
        self.assertEqual(squash(text), squash(R.SQL_LOG_RANGE))

    def test_manifest_authority_and_db_name(self):
        base = os.path.join(os.path.dirname(__file__), "..", "..", "modules", "assistant-share", "android", "src", "main")
        manifest = open(os.path.join(base, "AndroidManifest.xml"), encoding="utf-8").read()
        self.assertIn('android:authorities="com.hwetj.routinelog.assistant"', manifest)
        self.assertIn('android:exported="true"', manifest)
        provider = open(os.path.join(base, "java", "expo", "modules", "assistantshare", "AssistantShareProvider.kt"), encoding="utf-8").read()
        shared = open(os.path.join(base, "java", "expo", "modules", "assistantshare", "SharedDb.kt"), encoding="utf-8").read()
        # DB 파일 이름은 SharedDb(앱 JS 와 제공자가 같이 쓰는 연결)에 한 번만 있고, 앱의 DB_NAME 과 같아야 한다
        self.assertIn('const val DB_FILE = "routinelog.db"', shared)
        self.assertIn('"SQLite/$DB_FILE"', shared)
        self.assertNotIn("openDatabase", provider)  # 제공자는 자기 연결을 열지 않는다
        app_db = open(os.path.join(base, "..", "..", "..", "..", "..", "src", "db", "index.ts"), encoding="utf-8").read()
        self.assertIn("DB_NAME = 'routinelog.db'", app_db)
        self.assertIn('if (method == "ping") return ping(ctx)', provider)
        self.assertIn('const val ALLOWED = "com.hwetj.assistant"', provider)
        self.assertIn('setOf("query", "log", "undo")', provider)


if __name__ == "__main__":
    unittest.main()
