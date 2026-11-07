import os
import sys
import subprocess

def main():
    root_dir = os.path.abspath(os.path.dirname(__file__))
    frontend_dist = os.path.join(root_dir, "frontend", "dist")

    # If frontend is not built, build it once
    if not os.path.exists(frontend_dist) or not os.path.exists(os.path.join(frontend_dist, "index.html")):
        print("⚡ Building frontend for the first time...")
        subprocess.run(["npm.cmd", "--prefix", "frontend", "run", "build"], shell=True)

    python_exe = os.path.join(root_dir, "backend", "venv", "Scripts", "python.exe")
    if not os.path.exists(python_exe):
        python_exe = sys.executable

    print("\n" + "=" * 60)
    print("  🚀 AUTONEXIS Assistant - Unified Full-Stack Application")
    print("=" * 60)
    print("  Frontend UI & Backend API are running together at ONE link:")
    print("  👉 http://localhost:8000/")
    print("=" * 60 + "\n")

    cmd = [python_exe, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000"]
    subprocess.run(cmd)

if __name__ == "__main__":
    main()

