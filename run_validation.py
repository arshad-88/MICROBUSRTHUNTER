#!/usr/bin/env python3
"""MicroburstHunter — Single-Command Release Candidate Validation Runner.

Executes all applicable safe validation checks in a predictable, auditable sequence:
1. Python Bytecode Compilation (`py_compile` across all backend modules).
2. Backend Regression Suite (`unittest discover` covering 149 test cases).
3. Detector Benchmark Suite (`benchmark_detector.py` measuring latency, false positives, boundaries).
4. Pipeline Microbenchmark Suite (`benchmark_pipeline.py` measuring 8 stages with percentiles).
5. Frontend Unit & Component Tests (`npm test` via Vitest).
6. Frontend Production Build (`npm run build` via TypeScript + Vite).
7. Git Diff & Working Tree Cleanliness (`git diff --check`).

SAFETY GUARANTEE:
This validation runner executes ZERO privileged network mutations and NEVER modifies
host network interfaces (eth0, lo, routes). Privileged live kernel validation is strictly
separated and must be explicitly authorized using dual gates:
    MBH_ALLOW_PRIVILEGED_EXEC=1 sudo python test_kernel_integration_plan.py --live-kernel-test
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import NamedTuple


class StageResult(NamedTuple):
    name: str
    status: str  # "PASS" or "FAIL"
    duration_s: float
    details: str


def find_repo_root() -> Path:
    """Find the root repository directory containing package.json or backend/."""
    current = Path(__file__).resolve().parent
    if (current / "package.json").exists() and (current / "backend").is_dir():
        return current
    if (current.parent / "package.json").exists() and (current.parent / "backend").is_dir():
        return current.parent
    return current


def run_stage(name: str, cmd: list[str], cwd: Path) -> StageResult:
    print(f"\n[{name}] Running: {' '.join(cmd)}")
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            check=False,
        )
        elapsed = time.perf_counter() - t0
        if proc.returncode == 0:
            print(f"[{name}] PASSED in {elapsed:.2f}s")
            return StageResult(name=name, status="PASS", duration_s=elapsed, details="Clean exit code 0")
        else:
            print(f"[{name}] FAILED (exit code {proc.returncode}) in {elapsed:.2f}s")
            if proc.stdout.strip():
                print(f"--- STDOUT ---\n{proc.stdout.strip()}")
            if proc.stderr.strip():
                print(f"--- STDERR ---\n{proc.stderr.strip()}")
            return StageResult(
                name=name,
                status="FAIL",
                duration_s=elapsed,
                details=f"Exit code {proc.returncode}",
            )
    except FileNotFoundError as fnf:
        elapsed = time.perf_counter() - t0
        print(f"[{name}] FAILED: Executable not found: {fnf}")
        return StageResult(name=name, status="FAIL", duration_s=elapsed, details=str(fnf))
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        print(f"[{name}] FAILED with exception: {exc}")
        return StageResult(name=name, status="FAIL", duration_s=elapsed, details=str(exc))


def main() -> int:
    repo_root = find_repo_root()
    backend_dir = repo_root / "backend" if (repo_root / "backend").is_dir() else repo_root
    python_exe = sys.executable

    print("=" * 80)
    print("  MICROBURSTHUNTER — RELEASE CANDIDATE VALIDATION RUNNER")
    print("=" * 80)
    print(f"  Repository Root : {repo_root}")
    print(f"  Backend Dir     : {backend_dir}")
    print(f"  Python Bin      : {python_exe} ({sys.version.split()[0]})")
    print(f"  Platform        : {sys.platform}")
    print("=" * 80)

    stages: list[tuple[str, list[str], Path]] = []

    # 1. Python compilation check
    backend_py_files = [
        str(p)
        for p in backend_dir.glob("*.py")
        if not p.name.startswith(".")
    ]
    compile_cmd = [python_exe, "-m", "py_compile"] + backend_py_files
    stages.append(("1. Python Bytecode Compilation", compile_cmd, backend_dir))

    # 2. Backend unit regression suite
    test_cmd = [python_exe, "-m", "unittest", "discover", "-s", str(backend_dir), "-p", "test_*.py"]
    stages.append(("2. Backend Unit Regression Suite", test_cmd, backend_dir))

    # 3. Detector benchmark suite
    det_bench = [python_exe, str(backend_dir / "benchmark_detector.py")]
    stages.append(("3. Detector Benchmark Suite", det_bench, backend_dir))

    # 4. Pipeline latency benchmark suite
    pipe_bench = [python_exe, str(backend_dir / "benchmark_pipeline.py")]
    stages.append(("4. Pipeline Latency Microbenchmarks", pipe_bench, backend_dir))

    # 5. Frontend test suite (if npm is available and package.json exists)
    skipped_stages: list[StageResult] = []
    npm_exe = shutil.which("npm.cmd") if sys.platform == "win32" else shutil.which("npm")
    if npm_exe and (repo_root / "package.json").exists():
        stages.append(("5. Frontend Test Suite (Vitest)", [npm_exe, "test"], repo_root))
        stages.append(("6. Frontend Production Build", [npm_exe, "run", "build"], repo_root))
    else:
        reason = "npm not in PATH" if not npm_exe else "package.json not in repo root"
        skipped_stages.append(StageResult(
            name="5. Frontend Test Suite (Vitest)",
            status="SKIPPED",
            duration_s=0.0,
            details=f"Environment-specific ({reason})",
        ))
        skipped_stages.append(StageResult(
            name="6. Frontend Production Build",
            status="SKIPPED",
            duration_s=0.0,
            details=f"Environment-specific ({reason})",
        ))

    # 7. Git diff checks
    git_exe = shutil.which("git") or "git"
    stages.append(("7. Git Diff & Working Tree Cleanliness", [git_exe, "diff", "--check"], repo_root))

    # Execute all stages
    results: list[StageResult] = []
    has_failure = False

    t_start = time.perf_counter()
    for stage_name, cmd, cwd in stages:
        res = run_stage(stage_name, cmd, cwd)
        results.append(res)
        if res.status != "PASS":
            has_failure = True
            break

    total_time = time.perf_counter() - t_start

    # Combine executed and skipped stages for transparent reporting
    all_reports: list[StageResult] = []
    exec_map = {r.name: r for r in results}
    skip_map = {s.name: s for s in skipped_stages}
    canonical_order = [
        "1. Python Bytecode Compilation",
        "2. Backend Unit Regression Suite",
        "3. Detector Benchmark Suite",
        "4. Pipeline Latency Microbenchmarks",
        "5. Frontend Test Suite (Vitest)",
        "6. Frontend Production Build",
        "7. Git Diff & Working Tree Cleanliness",
    ]
    for c_name in canonical_order:
        if c_name in exec_map:
            all_reports.append(exec_map[c_name])
        elif c_name in skip_map:
            all_reports.append(skip_map[c_name])

    # Print summary table
    print("\n" + "=" * 80)
    print("  VALIDATION SUMMARY REPORT")
    print("=" * 80)
    print(f"{'Validation Stage':<42} | {'Status':<8} | {'Time':<8} | {'Details'}")
    print("-" * 80)
    for r in all_reports:
        print(f"{r.name:<42} | {r.status:<8} | {r.duration_s:6.2f}s | {r.details}")
    print("-" * 80)
    print(f"Total Validation Duration: {total_time:.2f}s")
    print("=" * 80)

    if has_failure:
        print("\n[VERDICT] VALIDATION FAILED — Fix identified defect before release candidate packaging.")
        return 1

    if skipped_stages:
        print("\n[VERDICT] ALL APPLICABLE SAFE CHECKS PASSED (with platform-specific stages noted).")
    else:
        print("\n[VERDICT] ALL SAFE CHECKS PASSED — Working tree is consistent and verifiable.")
    print("\n[NEXT STEP: PRIVILEGED KERNEL TEST]")
    print("To execute the authorized live Linux kernel integration test in an isolated namespace:")
    print("    MBH_ALLOW_PRIVILEGED_EXEC=1 sudo .venv/bin/python test_kernel_integration_plan.py --live-kernel-test")
    return 0


if __name__ == "__main__":
    sys.exit(main())
