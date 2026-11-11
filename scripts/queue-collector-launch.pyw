"""Run the queue collector without a visible Windows console."""

import argparse
import json
import os
from collections import deque
from pathlib import Path
import subprocess
import sys
import traceback


def completed_collection(output, start_offset):
    output.seek(start_offset)
    last_line = deque(output, maxlen=1)
    if not last_line:
        return False
    try:
        event = json.loads(last_line[0])
    except (ValueError, UnicodeError):
        return False
    return (
        isinstance(event, dict)
        and event.get("event") == "queue_job_completed"
        and str(event.get("jobId", "")).startswith("collection:")
        and event.get("exitCode") == 0
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("python_exe", type=Path)
    parser.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()

    scripts = Path(__file__).resolve().parent
    repo = scripts.parent
    log_path = args.config.with_name("queue-collector.log")
    rotated_log = log_path.with_suffix(".log.1")
    try:
        if log_path.stat().st_size >= 5 * 1024 * 1024:
            log_path.replace(rotated_log)
    except OSError:
        # A missing log or a log held open by a reader can be appended to.
        pass

    env = os.environ.copy()
    packages = repo / ".local-browser" / "python-deps"
    if packages.is_dir():
        env["PYTHONPATH"] = os.pathsep.join(
            part for part in (str(packages), env.get("PYTHONPATH")) if part
        )

    with log_path.open("a+b") as output:
        output.seek(0, os.SEEK_END)
        start_offset = output.tell()
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
            output.write(traceback.format_exc().encode("utf-8"))
            return 1
        succeeded = result.returncode == 0 and completed_collection(output, start_offset)
        empty = output.seek(0, os.SEEK_END) == 0
    if succeeded:
        rotated_log.unlink(missing_ok=True)
    if succeeded or empty:
        log_path.unlink(missing_ok=True)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
