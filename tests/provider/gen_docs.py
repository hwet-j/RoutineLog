"""docs/provider-sql.md 의 "## SQL" 절을 routine.py 상수에서 다시 만든다: python3 -m tests.provider.gen_docs"""
import os
from . import routine as R

NAMES = ['SQL_ROUTINES', 'SQL_ROUTINES_LITE', 'SQL_TIMES', 'SQL_TIMES_FOR', 'SQL_LOG_SELECT', 'SQL_LOG_RANGE', 'SQL_LOG_BY_ID', 'SQL_LOG_BY_REF',
         'SQL_LOG_SLOT', 'SQL_LOG_NOSLOT', 'SQL_SLOTS_USED', 'SQL_INSERT', 'SQL_DELETE', 'SQL_PROGRESS_COUNT', 'SQL_PROGRESS_SUM', 'SQL_ROUTINE_BY_ID', 'SQL_KV']

path = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "provider-sql.md")
doc = open(path, encoding="utf-8").read()
head = doc[:doc.index("## SQL")]
sql = "\n\n".join(f"-- {n}\n{getattr(R, n).strip()};" for n in NAMES)
open(path, "w", encoding="utf-8").write(head + "## SQL (tests/provider/routine.py 상수와 동일)\n```sql\n" + sql + "\n```\n")
