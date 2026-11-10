"""Run the queue collector without a visible Windows console."""

import argparse
import os
from pathlib import Path
import subprocess
import sys
import traceback


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("python_exe", type=Path)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    scripts = Path(__file__).resolve().parent
    repo = scripts.parent
    log_path = args.config.with_name("queue-collector.log")
    try:
        if log_path.stat().st_size >= 5 * 1024 * 1024:
            log_path.replace(log_path.with_suffix(".log.1"))
    except OSError:
        # A missing log or a log held open by a reader can be appended to.
        pass

    env = os.environ.copy()
    packages = repo / ".local-browser" / "python-deps"
    if packages.is_dir():
        env["PYTHONPATH"] = os.pathsep.join(
            part for part in (str(packages), env.get("PYTHONPATH")) if part
        )

    with log_path.open("a", encoding="utf-8") as output:
        try:
            result = subprocess.run(
                [str(args.python_exe), "-u", "-X", "utf8", str(scripts / "queue-collection.py"),
                 "--config", str(args.config)],
                cwd=repo,
                env=env,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
        except OSError:
            traceback.print_exc(file=output)
            return 1
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
