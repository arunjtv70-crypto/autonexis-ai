import sys
import os

current_dir = os.path.abspath(os.path.dirname(__file__))
parent_backend = os.path.abspath(os.path.join(current_dir, "..", "backend"))
local_backend = os.path.abspath(os.path.join(current_dir, "backend"))

for path in [parent_backend, local_backend, current_dir]:
    if os.path.exists(path) and path not in sys.path:
        sys.path.insert(0, path)

try:
    from main import app
except ImportError:
    from backend.main import app
