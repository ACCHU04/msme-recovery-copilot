import os

# Unit tests always run against the in-memory store in demo auth mode
os.environ["STORE"] = "memory"
os.environ["AUTH_MODE"] = "demo"

