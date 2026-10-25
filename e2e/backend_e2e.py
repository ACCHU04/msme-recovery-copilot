"""TEST HARNESS ONLY. The real backend in AUTH_MODE=supabase (JWT verification and role
checks unchanged), with the in-memory store for business data and the `profiles` table read
from the stand-in's Postgres, the way SupabaseStore would read it with the service key.

    STANDIN_DB=... JWT_SECRET=... uvicorn backend_e2e:app --port 8000   (run from e2e/, with backend/ on PYTHONPATH)
"""
import os

import psycopg

from app.config import Settings
from app.main import create_app
from app.store import MemoryStore

DB = os.environ["STANDIN_DB"]


class E2EStore(MemoryStore):
    def get(self, table, id):
        if table != "profiles":
            return super().get(table, id)
        with psycopg.connect(DB) as c:
            r = c.execute("select id, role, approval_status from public.profiles where id = %s", (id,)).fetchone()
        return {"id": str(r[0]), "role": r[1], "approval_status": r[2]} if r else None


settings = Settings(store="memory", auth_mode="supabase", supabase_url=None, supabase_service_key=None,
                    supabase_jwt_secret=os.environ["JWT_SECRET"], cors_origins=[],
                    demo_business_id="11111111-1111-1111-1111-111111111111")
app = create_app(settings, E2EStore(seed=True))
