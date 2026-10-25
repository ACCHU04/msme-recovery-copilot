import os
import sys
from pathlib import Path

# Add backend directory to sys.path so app, recovery_engine, copilot can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Unit tests always run against the in-memory store in demo auth mode
os.environ["STORE"] = "memory"
os.environ["AUTH_MODE"] = "demo"

